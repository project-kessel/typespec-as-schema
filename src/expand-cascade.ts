// Cascade-Delete Expansion
//
// Platform-level expansion that wires CascadeDeletePolicy declarations into
// SpiceDB "delete" permissions. Provider-specific scaffold wiring (e.g., RBAC's
// delete chain through role/role_binding/workspace) must run before this
// function via the provider's onBeforeCascadeDelete hook.

import type { ResourceDef, CascadeDeleteEntry } from "./types.js";
import { slotName, cloneResources } from "./utils.js";
import { hasRelation, addRelation } from "./primitives.js";

export interface CascadeExpansionResult {
  resources: ResourceDef[];
  warnings: string[];
}

export function expandCascadeDeletePolicies(
  resources: ResourceDef[],
  policies: CascadeDeleteEntry[],
): CascadeExpansionResult {
  const warnings: string[] = [];

  if (policies.length === 0) return { resources: cloneResources(resources), warnings };

  const result = cloneResources(resources);

  for (const policy of policies) {
    const nsPrefix = policy.childApplication.toLowerCase();
    const childName = policy.childResource.toLowerCase();
    const child = result.find((r) => r.name === childName && r.namespace === nsPrefix);
    if (!child) {
      warnings.push(
        `CascadeDeletePolicy references unknown child "${nsPrefix}/${childName}" — skipped`,
      );
      continue;
    }

    if (hasRelation(child, "delete")) continue;

    addRelation(child, {
      name: "delete",
      body: { kind: "subref", name: slotName(policy.parentRelation), subname: "delete" },
    });
  }

  return { resources: result, warnings };
}
