import { describe, it, expect } from "vitest";
import { defineProvider, type ProviderConfig } from "../../src/define-provider.js";
import type { DiscoveredExtension, ProviderExpansionResult } from "../../src/provider.js";
import type { ResourceDef } from "../../src/types.js";

function minimalConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: "test-provider",
    templates: [{
      templateName: "TestExtension",
      paramNames: ["application", "resource", "verb"],
      namespace: "TestNS",
    }],
    expand(_resources: ResourceDef[], _discovered: DiscoveredExtension[]): ProviderExpansionResult {
      return { resources: _resources, warnings: [] };
    },
    ...overrides,
  };
}

describe("defineProvider", () => {
  it("returns an ExtensionProvider with all required fields", () => {
    const provider = defineProvider(minimalConfig());
    expect(provider.id).toBe("test-provider");
    expect(provider.templates).toHaveLength(1);
    expect(provider.templates[0].templateName).toBe("TestExtension");
    expect(typeof provider.discover).toBe("function");
    expect(typeof provider.expand).toBe("function");
  });

  it("passes through optional metadata fields", () => {
    const provider = defineProvider(minimalConfig({
      ownedNamespaces: ["test"],
      costPerInstance: 5,
      applicationParamKey: "application",
      permissionParamKey: "verb",
    }));
    expect(provider.ownedNamespaces).toEqual(["test"]);
    expect(provider.costPerInstance).toBe(5);
    expect(provider.applicationParamKey).toBe("application");
    expect(provider.permissionParamKey).toBe("verb");
  });

  it("defaults costPerInstance to undefined (pipeline defaults to 1)", () => {
    const provider = defineProvider(minimalConfig());
    expect(provider.costPerInstance).toBeUndefined();
  });

  it("passes through onBeforeCascadeDelete when provided", () => {
    const hook = (resources: ResourceDef[]) => resources;
    const provider = defineProvider(minimalConfig({ onBeforeCascadeDelete: hook }));
    expect(provider.onBeforeCascadeDelete).toBe(hook);
  });

  it("omits onBeforeCascadeDelete when not provided", () => {
    const provider = defineProvider(minimalConfig());
    expect(provider.onBeforeCascadeDelete).toBeUndefined();
  });

  it("delegates expand to the config function", () => {
    const expanded: ResourceDef[] = [{ name: "expanded", namespace: "ns", relations: [] }];
    const provider = defineProvider(minimalConfig({
      expand: () => ({ resources: expanded, warnings: ["test-warning"] }),
    }));

    const result = provider.expand([], []);
    expect(result.resources).toBe(expanded);
    expect(result.warnings).toEqual(["test-warning"]);
  });

  it("uses custom discover when provided", () => {
    const customDiscovered: DiscoveredExtension[] = [
      { kind: "Custom", params: { key: "value" } },
    ];
    const provider = defineProvider(minimalConfig({
      discover: () => customDiscovered,
    }));

    // Cast to any since discover expects Program but we're testing the delegation
    const result = provider.discover(null as any);
    expect(result).toBe(customDiscovered);
  });

  it("supports multiple templates", () => {
    const provider = defineProvider(minimalConfig({
      templates: [
        { templateName: "ExtA", paramNames: ["a", "b"], namespace: "NS" },
        { templateName: "ExtB", paramNames: ["x", "y", "z"], namespace: "NS" },
      ],
    }));
    expect(provider.templates).toHaveLength(2);
    expect(provider.templates[0].templateName).toBe("ExtA");
    expect(provider.templates[1].templateName).toBe("ExtB");
  });
});

describe("defineProvider auto-discovery integration", () => {
  it("auto-discover returns empty array when program has no matching templates", () => {
    const provider = defineProvider(minimalConfig());
    // A minimal mock program with no types — discovery finds nothing
    const mockProgram = {
      getGlobalNamespaceType: () => ({ models: new Map(), namespaces: new Map() }),
      sourceFiles: new Map(),
    };
    const result = provider.discover(mockProgram as any);
    expect(result).toEqual([]);
  });
});
