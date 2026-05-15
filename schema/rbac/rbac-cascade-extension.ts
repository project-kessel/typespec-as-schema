// RBAC Cascade-Delete Scaffold Extension
//
// Ensures role, role_binding, and workspace have `delete` permissions
// before the platform's generic cascade-delete expansion runs.

import type { ExtensionModule } from "../../src/extension-loader.js";
import type { ResourceGraph } from "../../src/resource-graph.js";
import { ref, subref, or, and } from "../../src/primitives.js";

const RBAC = {
  subject: "subject",
  granted: "granted",
  binding: "binding",
  parent: "parent",
  globalWildcard: "any_any_any",
} as const;

export default {
  template: { templateName: "_RbacCascadeScaffold", paramNames: [], namespace: "__internal" },

  expand(): void {},

  beforeCascadeDelete(graph: ResourceGraph): void {
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
  },
} satisfies ExtensionModule;
