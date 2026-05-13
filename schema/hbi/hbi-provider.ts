// HBI Extension Provider
//
// For each ExposeHostPermission instance, adds a computed permission
// to inventory/host gated on `view & workspace.{v2Perm}`.

import type { ResourceDef } from "../../src/types.js";
import type { ProviderExpansionResult } from "../../src/provider.js";
import { defineProvider, validParams } from "../../src/define-provider.js";
import { and, ref, subref, addRelation, hasRelation } from "../../src/primitives.js";
import { findResource, cloneResources } from "../../src/utils.js";

interface HostPermExtension {
  v2Perm: string;
  hostPerm: string;
}

function exposeHostPermissions(baseResources: ResourceDef[], extensions: HostPermExtension[]): ProviderExpansionResult {
  const resources = cloneResources(baseResources);
  const host = findResource(resources, "inventory", "host");

  if (!host) {
    return { resources, warnings: ["HBI: inventory/host not found — expansion skipped."] };
  }

  for (const { v2Perm, hostPerm } of extensions) {
    if (hasRelation(host, hostPerm)) continue;
    addRelation(host, {
      name: hostPerm,
      body: and(ref("view"), subref("workspace", v2Perm)),
    });
  }

  return { resources, warnings: [] };
}

const HBI_KEYS = ["v2Perm", "hostPerm"] as const;

export const hbiProvider = defineProvider({
  id: "hbi",
  templates: [],
  expand: (resources, discovered) =>
    exposeHostPermissions(resources, validParams<HostPermExtension>(discovered, HBI_KEYS)),
});
