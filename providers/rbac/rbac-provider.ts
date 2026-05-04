// RBAC Extension Provider
//
// Owns the V1WorkspacePermission expansion logic: the 7 mutations per
// permission, view_metadata accumulation, and cascade-delete scaffold wiring.
//
// This is the TypeSpec equivalent of:
//   - TS-POC:     schema/rbac.ts → create_v1_based_workspace_permission()
//   - Starlark:   schema/rbac.star → v1_based_permission()
//   - CUE:        rbac/rbac.cue → #AddV1BasedPermission
//
// The platform pipeline invokes this provider's discover() and expand()
// through the ExtensionProvider interface. RBAC owns what happens when a
// V1WorkspacePermission alias is instantiated; the platform only orchestrates.

import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "../../src/types.js";
import type { ExtensionTemplateDef } from "../../src/registry.js";
import type { ExtensionProvider, DiscoveredExtension, ProviderExpansionResult } from "../../src/provider.js";
import type { DiscoveryWarnings } from "../../src/discover-platform.js";
import { discoverExtensionInstances } from "../../src/discover-extensions.js";
import { ref, subref, or, and, addRelation, hasRelation } from "../../src/primitives.js";
import { findResource, cloneResources } from "../../src/utils.js";

// ─── RBAC domain types ──────────────────────────────────────────────

type KesselVerb = "read" | "write" | "create" | "delete";

export interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

interface RBACScaffold {
  role: ResourceDef;
  roleBinding: ResourceDef;
  workspace: ResourceDef;
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

// ─── RBAC template definitions ──────────────────────────────────────

const V1_WORKSPACE_PERMISSION_TEMPLATE: ExtensionTemplateDef = {
  templateName: "V1WorkspacePermission",
  paramNames: ["application", "resource", "verb", "v2Perm"],
  namespace: "Kessel",
};

// ─── RBAC scaffold resolution ───────────────────────────────────────

function resolveRBACScaffold(resources: ResourceDef[]): { scaffold: RBACScaffold | null; warnings: string[] } {
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
      scaffold: null,
      warnings: [`RBAC scaffold incomplete — missing ${missing.join(", ")}. V1 permission expansion skipped.`],
    };
  }

  return { scaffold: { role, roleBinding, workspace }, warnings: [] };
}

// ─── RBAC expansion helpers ─────────────────────────────────────────

function addBoolRelation(resource: ResourceDef, name: string, seen: Set<string>): void {
  if (seen.has(name)) return;
  seen.add(name);
  addRelation(resource, { name, body: { kind: "bool", target: "rbac/principal" } });
}

// ─── V1 Permission Expansion ────────────────────────────────────────

export function expandV1Permissions(baseResources: ResourceDef[], permissions: V1Extension[]): ProviderExpansionResult {
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

// ─── Provider Implementation ────────────────────────────────────────

export function discoverV1Permissions(program: Program, warnings?: DiscoveryWarnings): V1Extension[] {
  const { results, skipped, aliasesAttempted, aliasesResolved } = discoverExtensionInstances(
    program,
    V1_WORKSPACE_PERMISSION_TEMPLATE,
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

export const rbacProvider: ExtensionProvider = {
  id: "rbac",
  ownedNamespaces: ["rbac"],
  costPerInstance: 7,
  applicationParamKey: "application",
  permissionParamKey: "v2Perm",

  templates: [V1_WORKSPACE_PERMISSION_TEMPLATE],

  discover(program: Program): DiscoveredExtension[] {
    const v1Perms = discoverV1Permissions(program);
    return v1Perms.map((p) => ({
      kind: "V1WorkspacePermission",
      params: {
        application: p.application,
        resource: p.resource,
        verb: p.verb,
        v2Perm: p.v2Perm,
      },
    }));
  },

  expand(resources: ResourceDef[], discovered: DiscoveredExtension[]): ProviderExpansionResult {
    const permissions: V1Extension[] = discovered
      .filter((d) => d.kind === "V1WorkspacePermission")
      .map((d) => ({
        application: d.params.application,
        resource: d.params.resource,
        verb: d.params.verb as KesselVerb,
        v2Perm: d.params.v2Perm,
      }));
    return expandV1Permissions(resources, permissions);
  },

  onBeforeCascadeDelete(resources: ResourceDef[]): ResourceDef[] {
    return wireDeleteScaffold(resources);
  },
};
