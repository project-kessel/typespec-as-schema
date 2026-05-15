// Decorator-Based Discovery
//
// Reads compiler state populated by decorators to discover platform
// extension instances. Supports both:
//   - Legacy: @cascadePolicy on model-is-template (state set)
//   - New:    @cascadeDelete / @resourceAnnotation with params (state map)

import type { Program, Model } from "@typespec/compiler";
import type { CascadeDeleteEntry, AnnotationEntry } from "./types.js";
import { StateKeys } from "./lib.js";
import { extractParams } from "./utils.js";

// ─── Cascade-delete policy discovery ─────────────────────────────────

export function discoverDecoratedCascadePolicies(program: Program): CascadeDeleteEntry[] {
  const results: CascadeDeleteEntry[] = [];
  const seen = new Set<string>();

  function addEntry(entry: CascadeDeleteEntry) {
    const key = `${entry.childApplication}/${entry.childResource}/${entry.parentRelation}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(entry);
  }

  // New: @cascadeDelete("parentRelation") — data stored in state map
  const cascadeMap = program.stateMap(StateKeys.cascadePolicy);
  for (const [, entries] of cascadeMap) {
    const arr = entries as CascadeDeleteEntry[];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (entry.childApplication && entry.childResource && entry.parentRelation) {
          addEntry(entry);
        }
      }
    }
  }

  // Legacy: @cascadePolicy on model-is-CascadeDeletePolicy — data in state set
  const tagged = program.stateSet(StateKeys.cascadePolicy);
  for (const type of tagged) {
    if (type.kind !== "Model") continue;
    const model = type as Model;
    const params = extractParams(model, ["childApplication", "childResource", "parentRelation"]);
    if (!params.childApplication || !params.childResource || !params.parentRelation) continue;
    addEntry({
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
  const annotations = new Map<string, AnnotationEntry[]>();

  function addEntry(app: string, resource: string, key: string, value: string) {
    const resourceKey = `${app}/${resource}`;
    let list = annotations.get(resourceKey);
    if (!list) {
      list = [];
      annotations.set(resourceKey, list);
    }
    if (!list.some((a) => a.key === key)) {
      list.push({ key, value });
    }
  }

  // New: @resourceAnnotation("key", "value") — data stored in state map
  const annotationMap = program.stateMap(StateKeys.annotation);
  for (const [, entries] of annotationMap) {
    const arr = entries as Array<{ application: string; resource: string; key: string; value: string }>;
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (entry.application && entry.resource && entry.key) {
          addEntry(entry.application, entry.resource, entry.key, entry.value ?? "");
        }
      }
    }
  }

  // Legacy: @annotation on model-is-ResourceAnnotation — data in state set
  const tagged = program.stateSet(StateKeys.annotation);
  for (const type of tagged) {
    if (type.kind !== "Model") continue;
    const model = type as Model;
    const params = extractParams(model, ["application", "resource", "key", "value"]);
    if (!params.application || !params.resource || !params.key) continue;
    addEntry(params.application, params.resource, params.key, params.value ?? "");
  }

  return annotations;
}
