// RBAC Extension Logic
//
// Owns the V1WorkspacePermission expansion: the 7 mutations per
// permission, view_metadata accumulation, and cascade-delete scaffold wiring.
//
// This is the TypeSpec equivalent of:
//   - TS-POC:     schema/rbac.ts → create_v1_based_workspace_permission()
//   - Starlark:   schema/rbac.star → v1_based_permission()
//   - CUE:        rbac/rbac.cue → #AddV1BasedPermission

import type { ResourceGraph } from "../../resource-graph.js";
import { ref, subref, or, and } from "../../primitives.js";
import { defineProvider } from "../../provider-registry.js";
import { StateKeys } from "../../lib.js";

// ─── RBAC domain types ──────────────────────────────────────────────

type KesselVerb = "read" | "write" | "create" | "delete";

export interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

export const VALID_VERBS = new Set<KesselVerb>(["read", "write", "create", "delete"]);

function isKesselVerb(v: string): v is KesselVerb {
  return VALID_VERBS.has(v as KesselVerb);
}

// ─── RBAC constants ─────────────────────────────────────────────────

const RBAC = {
  subject: "subject",
  granted: "granted",
  binding: "binding",
  parent: "parent",
  globalWildcard: "any_any_any",
} as const;

// ─── V1 Permission Expansion ────────────────────────────────────────

export function expandV1Permissions(graph: ResourceGraph, permissions: V1Extension[]): void {
  graph.ensure("rbac", "principal");

  const role = graph.get("rbac", "role");
  const roleBinding = graph.get("rbac", "role_binding");
  const workspace = graph.get("rbac", "workspace");

  if (!role || !roleBinding || !workspace) {
    const missing = [
      !role && "rbac/role",
      !roleBinding && "rbac/role_binding",
      !workspace && "rbac/workspace",
    ].filter(Boolean);
    graph.warn(`RBAC scaffold incomplete — missing ${missing.join(", ")}. V1 permission expansion skipped.`);
    return;
  }

  const viewMetadataRefs: string[] = [];

  for (const perm of permissions) {
    const { application: app, resource: res, verb, v2Perm: v2 } = perm;

    role.addBoolRelation(`${app}_any_any`, "rbac/principal");
    role.addBoolRelation(`${app}_${res}_any`, "rbac/principal");
    role.addBoolRelation(`${app}_any_${verb}`, "rbac/principal");
    role.addBoolRelation(`${app}_${res}_${verb}`, "rbac/principal");

    role.addRelation(v2, or(
      ref(RBAC.globalWildcard),
      ref(`${app}_any_any`),
      ref(`${app}_${res}_any`),
      ref(`${app}_any_${verb}`),
      ref(`${app}_${res}_${verb}`),
    ));

    roleBinding.addRelation(v2, and(
      ref(RBAC.subject),
      subref(RBAC.granted, v2),
    ));

    workspace.addRelation(v2, or(
      subref(RBAC.binding, v2),
      subref(RBAC.parent, v2),
    ));

    if (verb === "read") {
      viewMetadataRefs.push(v2);
    }
  }

  if (viewMetadataRefs.length > 0) {
    workspace.addRelation("view_metadata", or(...viewMetadataRefs.map((r) => ref(r))));
  }
}

// ─── Cascade-Delete Scaffold Wiring ─────────────────────────────────

export function wireDeleteScaffold(graph: ResourceGraph): void {
  const role = graph.get("rbac", "role");
  const roleBinding = graph.get("rbac", "role_binding");
  const workspace = graph.get("rbac", "workspace");
  if (!role || !roleBinding || !workspace) return;

  if (!role.hasRelation("delete")) {
    role.addRelation("delete", ref(RBAC.globalWildcard));
  }
  if (!roleBinding.hasRelation("delete")) {
    roleBinding.addRelation("delete", and(
      ref(RBAC.subject),
      subref(RBAC.granted, "delete"),
    ));
  }
  if (!workspace.hasRelation("delete")) {
    workspace.addRelation("delete", or(
      subref(RBAC.binding, "delete"),
      subref(RBAC.parent, "delete"),
    ));
  }
}

// ─── Provider registration via defineProvider ────────────────────────

export const rbacProvider = defineProvider<V1Extension>({
  name: "rbac",
  ownedNamespaces: ["rbac"],

  stateKey: StateKeys.v1Permission,
  filter: (p) => !!(p.application && p.resource && p.verb && p.v2Perm) && isKesselVerb(p.verb),

  expand(graph, permissions) {
    expandV1Permissions(graph, permissions);
  },

  postExpand(graph) {
    wireDeleteScaffold(graph);
  },

  contributeMetadata(permissions) {
    const permissionsByApp: Record<string, string[]> = {};
    for (const perm of permissions) {
      if (!permissionsByApp[perm.application]) {
        permissionsByApp[perm.application] = [];
      }
      permissionsByApp[perm.application].push(perm.v2Perm);
    }
    return { permissionsByApp };
  },
});
