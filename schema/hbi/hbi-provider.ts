// HBI Extension Provider
//
// For each ExposeHostPermission instance, adds a computed permission
// to inventory/host gated on `view & workspace.{v2Perm}`.
//
// Also exports the $exposeHostPermission decorator so schema authors
// can write `@HBI.exposeHostPermission(v2Perm, hostPerm)` on models.

import type { DecoratorContext, Model } from "@typespec/compiler";
import { setTypeSpecNamespace } from "@typespec/compiler";
import type { ResourceDef } from "../../src/types.js";
import type { ProviderExpansionResult } from "../../src/provider.js";
import { $lib } from "../../src/lib.js";
import { defineProvider, validParams } from "../../src/define-provider.js";
import { and, ref, subref, addRelation, hasRelation } from "../../src/primitives.js";
import { findResource, cloneResources } from "../../src/utils.js";

// ─── Decorator: @exposeHostPermission ────────────────────────────────

const HostPermStateKey = $lib.createStateSymbol("exposeHostPermission");

export function $exposeHostPermission(
  context: DecoratorContext,
  target: Model,
  v2Perm: string,
  hostPerm: string,
) {
  const map = context.program.stateMap(HostPermStateKey);
  const existing = (map.get(target) as Record<string, string>[] | undefined) ?? [];
  existing.push({ v2Perm, hostPerm });
  map.set(target, existing);
}

setTypeSpecNamespace("HBI", $exposeHostPermission);

// ─── Types ───────────────────────────────────────────────────────────

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
  templates: [{
    templateName: "ExposeHostPermission",
    paramNames: ["v2Perm", "hostPerm"],
    namespace: "HBI",
  }],
  decorators: [{ stateKey: HostPermStateKey, kind: "ExposeHostPermission" }],
  expand: (resources, discovered) =>
    exposeHostPermissions(resources, validParams<HostPermExtension>(discovered, HBI_KEYS)),
});
