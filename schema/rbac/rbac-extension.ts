// RBAC V1 Workspace Permission Extension
//
// Equivalent of TS-POC's schema/rbac.ts → create_v1_based_workspace_permission().
// For each V1WorkspacePermission template instance, wires 7 relations
// across role / role_binding / workspace, accumulates view_metadata,
// and scaffolds cascade-delete.
//
// This is a self-service extension: the emitter discovers it by convention
// (file ends in -extension.ts) and runs it generically.

import type { ExtensionModule } from "../../src/extension-loader.js";
import type { ResourceGraph } from "../../src/resource-graph.js";
import { ref, subref, or, and } from "../../src/primitives.js";
import { slotName } from "../../src/utils.js";

type KesselVerb = "read" | "write" | "create" | "delete";

const VALID_VERBS = new Set<KesselVerb>(["read", "write", "create", "delete"]);

function isKesselVerb(v: string): v is KesselVerb {
  return VALID_VERBS.has(v as KesselVerb);
}

const VERB_TO_RELATION: Record<KesselVerb, string> = {
  read: "view",
  write: "update",
  create: "create",
  delete: "delete",
};

const RBAC = {
  subject: "subject",
  granted: "granted",
  binding: "binding",
  parent: "parent",
  globalWildcard: "any_any_any",
} as const;

export default {
  template: {
    templateName: "V1WorkspacePermission",
    paramNames: ["application", "resource", "verb", "v2Perm"],
    namespace: "Kessel",
  },

  expand(graph: ResourceGraph, instances: Record<string, string>[]): void {
    const permissions = instances.filter(
      (p) => !!(p.application && p.resource && p.verb && p.v2Perm) && isKesselVerb(p.verb),
    );

    graph.ensure("rbac", "principal");

    if (permissions.length === 0) return;

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

    // Auto-wire permission relations on service resources
    for (const resource of graph.toResources()) {
      const resPerms = permissions.filter((p) => p.application === resource.namespace);
      for (const perm of resPerms) {
        if (!isKesselVerb(perm.verb)) continue;
        const relName = VERB_TO_RELATION[perm.verb as KesselVerb];
        const handle = graph.get(resource.namespace, resource.name);
        if (handle && !handle.hasRelation(relName) && handle.hasRelation("workspace")) {
          handle.addRelation(relName, {
            kind: "subref",
            name: slotName("workspace"),
            subname: perm.v2Perm,
          });
        }
      }
    }
  },
} satisfies ExtensionModule;
