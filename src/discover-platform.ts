// Platform-Owned Discovery
//
// Discovers platform-neutral annotation and cascade-delete policy instances.
// Uses the generic discoverExtensionInstances from discover-extensions.ts.

import type { Program } from "@typespec/compiler";
import type { CascadeDeleteEntry, AnnotationEntry } from "./types.js";
import { PLATFORM_TEMPLATES, type ExtensionTemplateDef } from "./registry.js";
import { discoverExtensionInstances } from "./discover-extensions.js";

export interface DiscoveryStats {
  aliasesAttempted: number;
  aliasesResolved: number;
  resourcesFound: number;
  extensionsFound: number;
}

export interface DiscoveryWarnings {
  skipped: string[];
  stats: DiscoveryStats;
}

function getTemplate(name: string): ExtensionTemplateDef {
  const def = PLATFORM_TEMPLATES.find(t => t.templateName === name);
  if (!def) throw new Error(`Unknown platform template: ${name}`);
  return def;
}

export function discoverAnnotations(
  program: Program,
  warnings?: DiscoveryWarnings,
): Map<string, AnnotationEntry[]> {
  const def = getTemplate("ResourceAnnotation");
  const { results: raw, skipped, aliasesAttempted, aliasesResolved } = discoverExtensionInstances(program, def);
  if (warnings) {
    warnings.skipped.push(...skipped);
    warnings.stats.aliasesAttempted += aliasesAttempted;
    warnings.stats.aliasesResolved += aliasesResolved;
  }

  const annotations = new Map<string, AnnotationEntry[]>();
  for (const params of raw) {
    if (!params.application || !params.resource || !params.key) continue;
    const resourceKey = `${params.application}/${params.resource}`;
    let list = annotations.get(resourceKey);
    if (!list) {
      list = [];
      annotations.set(resourceKey, list);
    }
    list.push({ key: params.key, value: params.value ?? "" });
  }
  return annotations;
}

export function discoverCascadeDeletePolicies(
  program: Program,
  warnings?: DiscoveryWarnings,
): CascadeDeleteEntry[] {
  const def = getTemplate("CascadeDeletePolicy");
  const { results, skipped, aliasesAttempted, aliasesResolved } = discoverExtensionInstances(program, def);
  if (warnings) {
    warnings.skipped.push(...skipped);
    warnings.stats.aliasesAttempted += aliasesAttempted;
    warnings.stats.aliasesResolved += aliasesResolved;
  }
  return results.filter(
    (p): p is Record<string, string> & CascadeDeleteEntry =>
      !!(p.childApplication && p.childResource && p.parentRelation),
  );
}
