// RBAC Extension Logic
//
// Owns the V1WorkspacePermission expansion: the 7 mutations per
// permission, view_metadata accumulation, and cascade-delete scaffold wiring.
//
// This is the TypeSpec equivalent of:
//   - TS-POC:     schema/rbac.ts → create_v1_based_workspace_permission()
//   - Starlark:   schema/rbac.star → v1_based_permission()
//   - CUE:        rbac/rbac.cue → #AddV1BasedPermission

import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "../../types.js";
import { ref, subref, or, and, addRelation, hasRelation } from "../../primitives.js";
import { findResource, cloneResources } from "../../utils.js";
import { defineProvider } from "../../provider-registry.js";
import { discoverTemplateInstances } from "../../discover-templates.js";

// ─── RBAC domain types ──────────────────────────────────────────────

type KesselVerb = "read" | "write" | "create" | "delete";

export interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

export interface ExpansionResult {
  resources: ResourceDef[];
  warnings: string[];
}

// ─── RBAC constants ─────────────────────────────────────────────────

const RBAC_RELATIONS = {
  subject: "subject",
  granted: "granted",
  binding: "binding",
  parent: "parent",
  globalWildcard: "any_any_any",
} as const;

export const VALID_VERBS = new Set<KesselVerb>(["read", "write", "create", "delete"]);

function isKesselVerb(v: string): v is KesselVerb {
  return VALID_VERBS.has(v as KesselVerb);
}

// ─── RBAC scaffold resolution ───────────────────────────────────────

function resolveRBACScaffold(resources: ResourceDef[]) {
  const role = findResource(resources, "rbac", "role");
  const roleBinding = findResource(resources, "rbac", "role_binding");
  const workspace = findResource(resources, "rbac", "workspace");

  if (!role || !roleBinding || !workspace) {
    const missing = [
      !role && "rbac/role",
      !roleBinding && "rbac/role_binding",
      !workspace && "rbac/workspace",
    ].filter(Boolean);
    return {
      scaffold: null as null,
      warnings: [`RBAC scaffold incomplete — missing ${missing.join(", ")}. V1 permission expansion skipped.`],
    };
  }

  return { scaffold: { role, roleBinding, workspace }, warnings: [] as string[] };
}

// ─── RBAC expansion helpers ─────────────────────────────────────────

function addBoolRelation(resource: ResourceDef, name: string, seen: Set<string>): void {
  if (seen.has(name)) return;
  seen.add(name);
  addRelation(resource, { name, body: { kind: "bool", target: "rbac/principal" } });
}

// ─── V1 Permission Expansion ────────────────────────────────────────

export function expandV1Permissions(baseResources: ResourceDef[], permissions: V1Extension[]): ExpansionResult {
  const resources = cloneResources(baseResources);

  if (!resources.some((r) => r.name === "principal" && r.namespace === "rbac")) {
    resources.unshift({ name: "principal", namespace: "rbac", relations: [] });
  }

  const { scaffold, warnings } = resolveRBACScaffold(resources);
  if (!scaffold) return { resources, warnings };

  const { role, roleBinding, workspace } = scaffold;

  const addedBoolRelations = new Set<string>();
  for (const rel of role.relations) {
    if (rel.body.kind === "bool") addedBoolRelations.add(rel.name);
  }

  const viewMetadataRefs: string[] = [];

  for (const perm of permissions) {
    const { application: app, resource: res, verb, v2Perm: v2 } = perm;

    addBoolRelation(role, `${app}_any_any`, addedBoolRelations);
    addBoolRelation(role, `${app}_${res}_any`, addedBoolRelations);
    addBoolRelation(role, `${app}_any_${verb}`, addedBoolRelations);
    addBoolRelation(role, `${app}_${res}_${verb}`, addedBoolRelations);

    addRelation(role, {
      name: v2,
      body: or(
        ref(RBAC_RELATIONS.globalWildcard),
        ref(`${app}_any_any`),
        ref(`${app}_${res}_any`),
        ref(`${app}_any_${verb}`),
        ref(`${app}_${res}_${verb}`),
      ),
    });

    addRelation(roleBinding, {
      name: v2,
      body: and(ref(RBAC_RELATIONS.subject), subref(RBAC_RELATIONS.granted, v2)),
    });

    addRelation(workspace, {
      name: v2,
      body: or(subref(RBAC_RELATIONS.binding, v2), subref(RBAC_RELATIONS.parent, v2)),
    });

    if (verb === "read") {
      viewMetadataRefs.push(v2);
    }
  }

  if (viewMetadataRefs.length > 0) {
    addRelation(workspace, {
      name: "view_metadata",
      body: or(...viewMetadataRefs.map((r) => ref(r))),
    });
  }

  return { resources, warnings };
}

// ─── Cascade-Delete Scaffold Wiring ─────────────────────────────────

export function wireDeleteScaffold(resources: ResourceDef[]): ResourceDef[] {
  const result = cloneResources(resources);
  const { scaffold } = resolveRBACScaffold(result);
  if (!scaffold) return result;

  const { role, roleBinding, workspace } = scaffold;

  if (!hasRelation(role, "delete")) {
    addRelation(role, { name: "delete", body: ref(RBAC_RELATIONS.globalWildcard) });
  }
  if (!hasRelation(roleBinding, "delete")) {
    addRelation(roleBinding, {
      name: "delete",
      body: and(ref(RBAC_RELATIONS.subject), subref(RBAC_RELATIONS.granted, "delete")),
    });
  }
  if (!hasRelation(workspace, "delete")) {
    addRelation(workspace, {
      name: "delete",
      body: or(subref(RBAC_RELATIONS.binding, "delete"), subref(RBAC_RELATIONS.parent, "delete")),
    });
  }
  return result;
}

// ─── V1 Permission Discovery (test/pipeline utility) ────────────────

export interface DiscoveryStats {
  aliasesAttempted: number;
  aliasesResolved: number;
  resourcesFound: number;
  extensionsFound: number;
}

export interface DiscoveryWarnings {
  skipped: string[];
  stats: DiscoveryStats;
}

const V1_TEMPLATE_DEF = {
  templateName: "V1WorkspacePermission",
  paramNames: ["application", "resource", "verb", "v2Perm"] as string[],
  namespace: "Kessel",
};

export function discoverV1Permissions(program: Program, warnings?: DiscoveryWarnings): V1Extension[] {
  const { results, skipped, aliasesAttempted, aliasesResolved } = discoverTemplateInstances(
    program,
    V1_TEMPLATE_DEF,
  );
  if (warnings) {
    warnings.skipped.push(...skipped);
    warnings.stats.aliasesAttempted += aliasesAttempted;
    warnings.stats.aliasesResolved += aliasesResolved;
  }
  const extensions = results
    .filter((p) => !!(p.application && p.resource && p.verb && p.v2Perm) && isKesselVerb(p.verb))
    .map((p) => ({
      application: p.application,
      resource: p.resource,
      verb: p.verb as KesselVerb,
      v2Perm: p.v2Perm,
    }));
  if (warnings) warnings.stats.extensionsFound += extensions.length;
  return extensions;
}

// ─── Provider registration via defineProvider ────────────────────────

export const rbacProvider = defineProvider<V1Extension>({
  name: "rbac",
  ownedNamespaces: ["rbac"],

  template: {
    name: "V1WorkspacePermission",
    params: ["application", "resource", "verb", "v2Perm"],
    filter: (p) => !!(p.application && p.resource && p.verb && p.v2Perm) && isKesselVerb(p.verb),
  },

  expand(resources, permissions) {
    return expandV1Permissions(resources, permissions);
  },

  postExpand(resources) {
    return wireDeleteScaffold(resources);
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
