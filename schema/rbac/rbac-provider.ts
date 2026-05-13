// RBAC Extension Provider
//
// Equivalent of TS-POC's create_v1_based_workspace_permission():
// for each discovered V1WorkspacePermission instance, wire 7 relations
// across role / role_binding / workspace, accumulate view_metadata,
// and scaffold cascade-delete.

import type { ResourceDef } from "../../src/types.js";
import type { ProviderExpansionResult } from "../../src/provider.js";
import { defineProvider } from "../../src/define-provider.js";
import { ref, subref, or, and, addRelation, hasRelation } from "../../src/primitives.js";
import { findResource, cloneResources } from "../../src/utils.js";

type KesselVerb = "read" | "write" | "create" | "delete";

export interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

export const VALID_VERBS = new Set<KesselVerb>(["read", "write", "create", "delete"]);

// ─── Core expansion: the "create_v1_based_workspace_permission" logic ─

export function expandV1Permissions(baseResources: ResourceDef[], permissions: V1Extension[]): ProviderExpansionResult {
  const resources = cloneResources(baseResources);

  if (!resources.some((r) => r.name === "principal" && r.namespace === "rbac")) {
    resources.unshift({ name: "principal", namespace: "rbac", relations: [] });
  }

  const role = findResource(resources, "rbac", "role");
  const roleBinding = findResource(resources, "rbac", "role_binding");
  const workspace = findResource(resources, "rbac", "workspace");

  if (!role || !roleBinding || !workspace) {
    return { resources, warnings: ["RBAC scaffold incomplete — expansion skipped."] };
  }

  const seenBools = new Set(role.relations.filter((r) => r.body.kind === "bool").map((r) => r.name));
  const viewMetadata: string[] = [];

  for (const { application: app, resource: res, verb, v2Perm: v2 } of permissions) {
    // 4 hierarchical bool grants on role
    for (const name of [`${app}_any_any`, `${app}_${res}_any`, `${app}_any_${verb}`, `${app}_${res}_${verb}`]) {
      if (!seenBools.has(name)) {
        seenBools.add(name);
        addRelation(role, { name, body: { kind: "bool", target: "rbac/principal" } });
      }
    }

    // Permission = union of all matching grants
    addRelation(role, {
      name: v2,
      body: or(ref("any_any_any"), ref(`${app}_any_any`), ref(`${app}_${res}_any`), ref(`${app}_any_${verb}`), ref(`${app}_${res}_${verb}`)),
    });

    // role_binding: subject ∩ granted->permission
    addRelation(roleBinding, { name: v2, body: and(ref("subject"), subref("granted", v2)) });

    // workspace: binding->permission ∪ parent->permission (inheritance)
    addRelation(workspace, { name: v2, body: or(subref("binding", v2), subref("parent", v2)) });

    if (verb === "read") viewMetadata.push(v2);
  }

  if (viewMetadata.length > 0) {
    addRelation(workspace, { name: "view_metadata", body: or(...viewMetadata.map((r) => ref(r))) });
  }

  return { resources, warnings: [] };
}

// ─── Cascade-delete scaffold ─────────────────────────────────────────

export function wireDeleteScaffold(baseResources: ResourceDef[]): ResourceDef[] {
  const resources = cloneResources(baseResources);
  const role = findResource(resources, "rbac", "role");
  const roleBinding = findResource(resources, "rbac", "role_binding");
  const workspace = findResource(resources, "rbac", "workspace");
  if (!role || !roleBinding || !workspace) return resources;

  if (!hasRelation(role, "delete")) addRelation(role, { name: "delete", body: ref("any_any_any") });
  if (!hasRelation(roleBinding, "delete")) addRelation(roleBinding, { name: "delete", body: and(ref("subject"), subref("granted", "delete")) });
  if (!hasRelation(workspace, "delete")) addRelation(workspace, { name: "delete", body: or(subref("binding", "delete"), subref("parent", "delete")) });

  return resources;
}

// ─── Provider definition ─────────────────────────────────────────────
// All metadata (ownedNamespaces, costPerInstance, param keys, template
// registry) comes from @provider on V1WorkspacePermission in rbac-extensions.tsp.

export const rbacProvider = defineProvider({
  id: "rbac",
  templates: [],
  expand: (resources, discovered) =>
    expandV1Permissions(resources, discovered.map((d) => d.params as unknown as V1Extension)),
  onBeforeCascadeDelete: wireDeleteScaffold,
});
