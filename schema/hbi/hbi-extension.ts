// HBI Expose Host Permission Extension
//
// For each ExposeHostPermission instance, adds a computed permission
// to inventory/host gated on `view & workspace.{v2Perm}`.

import type { ExtensionModule } from "../../src/extension-loader.js";
import type { ResourceGraph } from "../../src/resource-graph.js";
import { and, ref, subref } from "../../src/primitives.js";

export default {
  template: {
    templateName: "ExposeHostPermission",
    paramNames: ["v2Perm", "hostPerm"],
    namespace: "HBI",
  },

  expand(graph: ResourceGraph, instances: Record<string, string>[]): void {
    const valid = instances.filter((p) => !!(p.v2Perm && p.hostPerm));
    if (valid.length === 0) return;

    const host = graph.get("inventory", "host");
    if (!host) {
      graph.warn("HBI: inventory/host not found — expansion skipped.");
      return;
    }

    for (const { v2Perm, hostPerm } of valid) {
      if (host.hasRelation(hostPerm)) continue;
      host.addRelation(hostPerm, and(ref("view"), subref("workspace", v2Perm)));
    }
  },
} satisfies ExtensionModule;
