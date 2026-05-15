// RBAC Extension Provider
//
// Equivalent of TS-POC's schema/rbac.ts → create_v1_based_workspace_permission().
// For each V1WorkspacePermission template instance, wires 7 relations
// across role / role_binding / workspace, accumulates view_metadata,
// auto-wires permission relations, and scaffolds cascade-delete.
//
// Also exports the $v1Permission decorator so schema authors can write
// `@RBAC.v1Permission(verb, resource, application, v2Perm)` directly on models.

import type { DecoratorContext, Model } from "@typespec/compiler";
import { setTypeSpecNamespace } from "@typespec/compiler";
import type { ResourceDef } from "../../src/types.js";
import type { ProviderExpansionResult } from "../../src/provider.js";
import { $lib } from "../../src/lib.js";
import { defineProvider, validParams } from "../../src/define-provider.js";
import { ref, subref, or, and, addRelation, hasRelation } from "../../src/primitives.js";
import { findResource, cloneResources, slotName } from "../../src/utils.js";

// ─── Decorator: @v1Permission ────────────────────────────────────────

const V1PermStateKey = $lib.createStateSymbol("v1Permission");

export function $v1Permission(
  context: DecoratorContext,
  target: Model,
  verb: string,
  resource: string,
  application: string,
  v2Perm: string,
) {
  const map = context.program.stateMap(V1PermStateKey);
  const existing = (map.get(target) as Record<string, string>[] | undefined) ?? [];
  existing.push({ application, resource, verb, v2Perm });
  map.set(target, existing);
}

setTypeSpecNamespace("RBAC", $v1Permission);

// ─── Types ───────────────────────────────────────────────────────────

type KesselVerb = "read" | "write" | "create" | "delete";

const VALID_VERBS = new Set<KesselVerb>(["read", "write", "create", "delete"]);

const VERB_TO_RELATION: Record<KesselVerb, string> = {
  read: "view",
  write: "update",
  create: "create",
  delete: "delete",
};

interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

const V1_KEYS = ["application", "resource", "verb", "v2Perm"] as const;

// ─── V1 Permission Expansion ─────────────────────────────────────────

function expandV1Permissions(baseResources: ResourceDef[], permissions: V1Extension[]): ProviderExpansionResult {
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
    for (const name of [`${app}_any_any`, `${app}_${res}_any`, `${app}_any_${verb}`, `${app}_${res}_${verb}`]) {
      if (!seenBools.has(name)) {
        seenBools.add(name);
        addRelation(role, { name, body: { kind: "bool", target: "rbac/principal" } });
      }
    }

    addRelation(role, {
      name: v2,
      body: or(ref("any_any_any"), ref(`${app}_any_any`), ref(`${app}_${res}_any`), ref(`${app}_any_${verb}`), ref(`${app}_${res}_${verb}`)),
    });

    addRelation(roleBinding, { name: v2, body: and(ref("subject"), subref("granted", v2)) });

    addRelation(workspace, { name: v2, body: or(subref("binding", v2), subref("parent", v2)) });

    if (verb === "read") viewMetadata.push(v2);
  }

  if (viewMetadata.length > 0) {
    addRelation(workspace, { name: "view_metadata", body: or(...viewMetadata.map((r) => ref(r))) });
  }

  // Auto-wire permission relations on service resources
  for (const resource of resources) {
    const resPerms = permissions.filter((p) => p.application === resource.namespace);
    for (const perm of resPerms) {
      const relName = VERB_TO_RELATION[perm.verb];
      if (!resource.relations.some((r) => r.name === relName) && resource.relations.some((r) => r.name === "workspace")) {
        resource.relations.push({
          name: relName,
          body: { kind: "subref", name: slotName("workspace"), subname: perm.v2Perm },
        });
      }
    }
  }

  return { resources, warnings: [] };
}

// ─── Cascade-Delete Scaffold ─────────────────────────────────────────

function wireDeleteScaffold(baseResources: ResourceDef[]): ResourceDef[] {
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

// ─── Provider Definition ─────────────────────────────────────────────

export const rbacProvider = defineProvider({
  id: "rbac",
  templates: [{
    templateName: "V1WorkspacePermission",
    paramNames: ["application", "resource", "verb", "v2Perm"],
    namespace: "RBAC",
  }],
  decorators: [{ stateKey: V1PermStateKey, kind: "V1WorkspacePermission" }],
  expand: (resources, discovered) =>
    expandV1Permissions(resources, validParams<V1Extension>(discovered, V1_KEYS, (e) => VALID_VERBS.has(e.verb))),
  onBeforeCascadeDelete: wireDeleteScaffold,
});
