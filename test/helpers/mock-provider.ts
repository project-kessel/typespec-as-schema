import type { ExtensionProvider } from "../../src/provider.js";

export function createNoopProvider(id: string): ExtensionProvider {
  return {
    id,
    templates: [],
    discover: () => [],
    expand: (resources) => ({ resources, warnings: [] }),
  };
}
