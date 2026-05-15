// defineProvider — reduces extension provider boilerplate.
//
// Provider authors supply only their expansion logic and metadata;
// discovery is auto-generated from template definitions using
// the platform's discoverTemplateInstances utility.

import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "./types.js";
import type { TemplateDef } from "./discover-templates.js";
import type { ExtensionProvider, DiscoveredExtension, ProviderExpansionResult } from "./provider.js";
import { discoverTemplateInstances } from "./discover-templates.js";

export interface ProviderConfig {
  id: string;
  templates: TemplateDef[];
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

export function defineProvider(config: ProviderConfig): ExtensionProvider {
  const discover = config.discover ?? function autoDiscover(program: Program): DiscoveredExtension[] {
    const discovered: DiscoveredExtension[] = [];
    for (const template of config.templates) {
      const { results } = discoverTemplateInstances(program, template);
      for (const params of results) {
        if (Object.keys(params).length === template.paramNames.length) {
          discovered.push({ kind: template.templateName, params });
        }
      }
    }
    return discovered;
  };

  return {
    id: config.id,
    templates: config.templates,
    discover,
    expand: config.expand,
    onBeforeCascadeDelete: config.onBeforeCascadeDelete,
  };
}
