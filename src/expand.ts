// V1 Permission Expansion
//
// Pure expansion math — takes discovered data and produces enriched SpiceDB
// resource definitions. No AST walking, no TypeSpec imports.

import type { ResourceDef, RelationDef, RelationBody, V1Extension, CascadeDeleteEntry, RBACScaffold } from "./types.js";
import { slotName, findResource, cloneResources } from "./utils.js";

// ─── Types ──────────────────────────────────────────────────────────

export interface ScaffoldResult {
  scaffold: RBACScaffold | null;
  warnings: string[];
}

export interface ExpansionResult {
  resources: ResourceDef[];
  warnings: string[];
}

// ─── Expansion helpers ──────────────────────────────────────────────

const RBAC_RELATIONS = {
  subject: "subject",
  granted: "granted",
  binding: "binding",
  parent: "parent",
  globalWildcard: "any_any_any",
} as const;

function addRelation(resource: ResourceDef, rel: RelationDef): void {
  resource.relations.push(rel);
}

function addBoolRelation(resource: ResourceDef, name: string, seen: Set<string>): void {
  if (seen.has(name)) return;
  seen.add(name);
  addRelation(resource, {
    name,
    body: { kind: "bool", target: "rbac/principal" },
  });
}

function ref(name: string): RelationBody {
  return { kind: "ref", name };
}

function subref(name: string, subname: string): RelationBody {
  return { kind: "subref", name: slotName(name), subname };
}

function or(...members: RelationBody[]): RelationBody {
  return { kind: "or", members };
}

function and(...members: RelationBody[]): RelationBody {
  return { kind: "and", members };
}

// ─── RBAC Scaffold ──────────────────────────────────────────────────

export function resolveRBACScaffold(resources: ResourceDef[]): ScaffoldResult {
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
      warnings: [
        `RBAC scaffold incomplete — missing ${missing.join(", ")}. V1 permission expansion skipped.`,
      ],
    };
  }

  return { scaffold: { role, roleBinding, workspace }, warnings: [] };
}

// ─── V1 Permission Expansion ────────────────────────────────────────

/**
 * Expands V1WorkspacePermission declarations into SpiceDB relations.
 * Explicit, no string parsing, no interpolation.
 */
export function expandV1Permissions(
  baseResources: ResourceDef[],
  permissions: V1Extension[],
): ExpansionResult {
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

// ─── CascadeDeletePolicy Expansion ──────────────────────────────────

function hasRelation(resource: ResourceDef, name: string): boolean {
  return resource.relations.some((r) => r.name === name);
}

/**
 * Expands CascadeDeletePolicy declarations into SpiceDB permissions.
 * For each policy, adds a "delete" permission on the child resource that
 * resolves through the parent relation's delete permission, and wires the
 * "delete" permission through the full RBAC chain (role -> role_binding ->
 * workspace) so the arrow reference is resolvable.
 */
export function expandCascadeDeletePolicies(
  resources: ResourceDef[],
  policies: CascadeDeleteEntry[],
): ResourceDef[] {
  if (policies.length === 0) return cloneResources(resources);

  const result = cloneResources(resources);

  const { scaffold } = resolveRBACScaffold(result);
  if (scaffold) {
    const { role, roleBinding, workspace } = scaffold;

    if (!hasRelation(role, "delete")) {
      addRelation(role, {
        name: "delete",
        body: ref(RBAC_RELATIONS.globalWildcard),
      });
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
  }

  for (const policy of policies) {
    const nsPrefix = policy.childApplication.toLowerCase();
    const childName = policy.childResource.toLowerCase();
    const child = result.find((r) => r.name === childName && r.namespace === nsPrefix);
    if (!child) continue;

    if (hasRelation(child, "delete")) continue;

    addRelation(child, {
      name: "delete",
      body: { kind: "subref", name: slotName(policy.parentRelation), subname: "delete" },
    });
  }

  return result;
}
