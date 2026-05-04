// Extension Template Registry
//
// Assembles extension template definitions from platform templates and
// registered providers. Templates tell the discovery system which TypeSpec
// model names to search for and what parameters to extract.

import type { ExtensionProvider } from "./provider.js";

export interface ExtensionTemplateDef {
  templateName: string;
  paramNames: string[];
  namespace: string;
}

/** Platform-owned templates that are provider-neutral. */
export const PLATFORM_TEMPLATES: readonly ExtensionTemplateDef[] = [
  { templateName: "ResourceAnnotation",  paramNames: ["application", "resource", "key", "value"], namespace: "Kessel" },
  { templateName: "CascadeDeletePolicy", paramNames: ["childApplication", "childResource", "parentRelation"], namespace: "Kessel" },
];

export interface RegistryResult {
  templates: ExtensionTemplateDef[];
  warnings: string[];
}

/**
 * Builds a combined registry from platform templates and provider-contributed templates.
 * Warns on duplicate (templateName, namespace) pairs across providers.
 */
export function buildRegistry(providers: ExtensionProvider[]): RegistryResult {
  const providerTemplates = providers.flatMap((p) => p.templates);
  const all = [...PLATFORM_TEMPLATES, ...providerTemplates];

  const warnings: string[] = [];
  const seen = new Map<string, string>();
  for (const t of providerTemplates) {
    const key = `${t.namespace}::${t.templateName}`;
    if (seen.has(key)) {
      warnings.push(
        `Duplicate template "${t.templateName}" in namespace "${t.namespace}" ` +
        `(first registered by provider that owns "${seen.get(key)}", duplicate found)`,
      );
    } else {
      seen.set(key, t.templateName);
    }
  }

  return { templates: all, warnings };
}
