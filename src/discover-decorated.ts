// Decorator-Based Discovery
//
// Reads compiler state sets populated by @cascadePolicy and @annotation
// decorators to discover platform extension instances.

import type { Program, Model } from "@typespec/compiler";
import type { CascadeDeleteEntry, AnnotationEntry } from "./types.js";
import { StateKeys } from "./lib.js";
import { getStringValue, extractParams } from "./utils.js";

// ─── Cascade-delete policy discovery ─────────────────────────────────

export function discoverDecoratedCascadePolicies(program: Program): CascadeDeleteEntry[] {
  const tagged = program.stateSet(StateKeys.cascadePolicy);
  const results: CascadeDeleteEntry[] = [];
  const seen = new Set<string>();

  for (const type of tagged) {
    if (type.kind !== "Model") continue;
    const model = type as Model;

    const params = extractParams(model, ["childApplication", "childResource", "parentRelation"]);
    if (!params.childApplication || !params.childResource || !params.parentRelation) continue;

    const key = `${params.childApplication}/${params.childResource}/${params.parentRelation}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      childApplication: params.childApplication,
      childResource: params.childResource,
      parentRelation: params.parentRelation,
    });
  }

  return results;
}

// ─── Annotation discovery ────────────────────────────────────────────

export function discoverDecoratedAnnotations(
  program: Program,
): Map<string, AnnotationEntry[]> {
  const tagged = program.stateSet(StateKeys.annotation);
  const annotations = new Map<string, AnnotationEntry[]>();

  for (const type of tagged) {
    if (type.kind !== "Model") continue;
    const model = type as Model;

    const params = extractParams(model, ["application", "resource", "key", "value"]);
    if (!params.application || !params.resource || !params.key) continue;

    const resourceKey = `${params.application}/${params.resource}`;
    let list = annotations.get(resourceKey);
    if (!list) {
      list = [];
      annotations.set(resourceKey, list);
    }
    if (!list.some((a) => a.key === params.key)) {
      list.push({ key: params.key, value: params.value ?? "" });
    }
  }

  return annotations;
}
