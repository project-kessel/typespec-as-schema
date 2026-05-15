// defineProvider — reduces extension provider boilerplate.
//
// Provider authors supply only their expansion logic and metadata;
// discovery is auto-generated from template definitions and/or
// decorator state maps using the platform's utilities.

import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "./types.js";
import type { TemplateDef } from "./discover-templates.js";
import type { ExtensionProvider, DiscoveredExtension, ProviderExpansionResult } from "./provider.js";
import { discoverTemplateInstances } from "./discover-templates.js";

export interface DecoratorSource {
  stateKey: symbol;
  kind: string;
}

export interface ProviderConfig {
  id: string;
  templates: TemplateDef[];
  decorators?: DecoratorSource[];
  expand(resources: ResourceDef[], discovered: DiscoveredExtension[]): ProviderExpansionResult;
  onBeforeCascadeDelete?(resources: ResourceDef[]): ResourceDef[];
  discover?(program: Program): DiscoveredExtension[];
}

/**
 * Extracts and validates typed params from discovered extensions in one pass.
 * Drops entries with missing/empty required keys. An optional `validate`
 * predicate allows provider-specific checks (e.g., verb allowlisting).
 */
export function validParams<T>(
  discovered: DiscoveredExtension[],
  requiredKeys: readonly string[],
  validate?: (parsed: T) => boolean,
): T[] {
  const results: T[] = [];
  for (const d of discovered) {
    let valid = true;
    for (const key of requiredKeys) {
      if (typeof d.params[key] !== "string" || d.params[key] === "") {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    const parsed = d.params as unknown as T;
    if (validate && !validate(parsed)) continue;
    results.push(parsed);
  }
  return results;
}

function deduplicateExtensions(extensions: DiscoveredExtension[]): DiscoveredExtension[] {
  const seen = new Set<string>();
  const result: DiscoveredExtension[] = [];
  for (const ext of extensions) {
    const key = ext.kind + ":" + JSON.stringify(ext.params, Object.keys(ext.params).sort());
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ext);
  }
  return result;
}

export function defineProvider(config: ProviderConfig): ExtensionProvider {
  const discover = config.discover ?? function autoDiscover(program: Program): DiscoveredExtension[] {
    const discovered: DiscoveredExtension[] = [];

    // Template-based discovery (alias usage)
    for (const template of config.templates) {
      const { results } = discoverTemplateInstances(program, template);
      for (const params of results) {
        if (Object.keys(params).length === template.paramNames.length) {
          discovered.push({ kind: template.templateName, params });
        }
      }
    }

    // Decorator-based discovery (state map usage)
    for (const dec of config.decorators ?? []) {
      const stateMap = program.stateMap(dec.stateKey);
      for (const [, entries] of stateMap) {
        const arr = entries as Record<string, string>[];
        for (const params of arr) {
          discovered.push({ kind: dec.kind, params });
        }
      }
    }

    return deduplicateExtensions(discovered);
  };

  return {
    id: config.id,
    templates: config.templates,
    discover,
    expand: config.expand,
    onBeforeCascadeDelete: config.onBeforeCascadeDelete,
  };
}
