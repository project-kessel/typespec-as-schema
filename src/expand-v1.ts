// V1 Workspace Permission Expansion
//
// Pure functions that expand @v1Permission declarations into RBAC
// relations on role, role_binding, and workspace resources.
//
// This is the TypeSpec equivalent of:
//   - TS-POC:     schema/rbac.ts → create_v1_based_workspace_permission()
//   - Starlark:   schema/rbac.star → v1_based_permission()
//   - CUE:        rbac/rbac.cue → #AddV1BasedPermission

import type { ResourceGraph } from "./resource-graph.js";
import { ref, subref, or, and } from "./primitives.js";

// ─── Types ───────────────────────────────────────────────────────────

type KesselVerb = "read" | "write" | "create" | "delete";

export interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

export const VALID_VERBS = new Set<KesselVerb>(["read", "write", "create", "delete"]);

export function isKesselVerb(v: string): v is KesselVerb {
  return VALID_VERBS.has(v as KesselVerb);
}

const VERB_TO_RELATION: Record<KesselVerb, string> = {
  read: "view",
  write: "update",
  create: "create",
  delete: "delete",
};

export function verbToRelationName(verb: KesselVerb): string {
  return VERB_TO_RELATION[verb];
}

// ─── RBAC constants ──────────────────────────────────────────────────

const RBAC = {
  subject: "subject",
  granted: "granted",
  binding: "binding",
  parent: "parent",
  globalWildcard: "any_any_any",
} as const;

// ─── V1 Permission Expansion ─────────────────────────────────────────

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

// ─── Cascade-Delete Scaffold Wiring ──────────────────────────────────

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

// ─── Auto-wire permission relations from @v1Permission ───────────────

import type { ResourceDef } from "./types.js";
import { slotName } from "./utils.js";

/**
 * For each resource with @v1Permission decorators, injects SubRef
 * relations (e.g. view -> workspace->v2Perm) so service authors don't
 * need to hand-write WorkspacePermission<"..."> properties.
 */
export function wirePermissionRelations(resources: ResourceDef[], permissions: V1Extension[]): void {
  for (const res of resources) {
    const resPerms = permissions.filter((p) => p.application === res.namespace);
    for (const perm of resPerms) {
      if (!isKesselVerb(perm.verb)) continue;
      const relName = verbToRelationName(perm.verb);
      const alreadyExists = res.relations.some((r) => r.name === relName);
      if (!alreadyExists && res.relations.some((r) => r.name === "workspace")) {
        res.relations.push({
          name: relName,
          body: { kind: "subref", name: slotName("workspace"), subname: perm.v2Perm },
        });
      }
    }
  }
}

// ─── Discovery helpers ───────────────────────────────────────────────

import type { Program } from "@typespec/compiler";
import { StateKeys } from "./lib.js";

export function discoverV1Permissions(program: Program): V1Extension[] {
  const stateMap = program.stateMap(StateKeys.v1Permission);
  const all: V1Extension[] = [];
  for (const [, entries] of stateMap) {
    const arr = entries as V1Extension[];
    if (Array.isArray(arr)) {
      all.push(...arr);
    }
  }
  return all.filter(
    (p) => !!(p.application && p.resource && p.verb && p.v2Perm) && isKesselVerb(p.verb),
  );
}

export interface PermissionsByApp {
  [application: string]: string[];
}

export function buildPermissionsByApp(permissions: V1Extension[]): PermissionsByApp {
  const result: PermissionsByApp = {};
  for (const perm of permissions) {
    if (!result[perm.application]) {
      result[perm.application] = [];
    }
    result[perm.application].push(perm.v2Perm);
  }
  return result;
}
