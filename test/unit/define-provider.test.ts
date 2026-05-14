import { describe, it, expect, beforeEach } from "vitest";
import {
  defineProvider,
  getProviders,
  clearProviders,
  type ProviderExpansionResult,
} from "../../src/provider-registry.js";
import type { ResourceDef } from "../../src/types.js";

beforeEach(() => {
  clearProviders();
});

interface FakeExtension {
  app: string;
  action: string;
}

describe("defineProvider", () => {
  it("self-registers the provider on creation", () => {
    defineProvider<FakeExtension>({
      name: "test-auto-register",
      ownedNamespaces: ["test"],
      template: { name: "FakeTemplate", params: ["app", "action"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
    });

    const providers = getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("test-auto-register");
  });

  it("rejects duplicate provider names", () => {
    defineProvider<FakeExtension>({
      name: "dup",
      ownedNamespaces: [],
      template: { name: "T", params: ["x"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
    });

    expect(() =>
      defineProvider<FakeExtension>({
        name: "dup",
        ownedNamespaces: [],
        template: { name: "T", params: ["x"] },
        expand(resources) {
          return { resources, warnings: [] };
        },
      }),
    ).toThrow('Provider "dup" is already registered');
  });

  it("sets ownedNamespaces on the registered provider", () => {
    defineProvider<FakeExtension>({
      name: "multi-ns",
      ownedNamespaces: ["ns_a", "ns_b"],
      template: { name: "T", params: ["app"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
    });

    expect(getProviders()[0].ownedNamespaces).toEqual(["ns_a", "ns_b"]);
  });

  it("defaults template namespace to 'Kessel' when not specified", () => {
    const provider = defineProvider<FakeExtension>({
      name: "default-ns",
      ownedNamespaces: [],
      template: { name: "MyTemplate", params: ["app", "action"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
    });

    expect(provider.name).toBe("default-ns");
  });

  it("wires postExpand when provided", () => {
    const provider = defineProvider<FakeExtension>({
      name: "with-post",
      ownedNamespaces: [],
      template: { name: "T", params: ["app"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
      postExpand(resources) {
        return [...resources, { name: "injected", namespace: "post", relations: [] }];
      },
    });

    const result = provider.postExpand!([{ name: "original", namespace: "app", relations: [] }]);
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe("injected");
  });

  it("omits postExpand when not provided", () => {
    const provider = defineProvider<FakeExtension>({
      name: "no-post",
      ownedNamespaces: [],
      template: { name: "T", params: ["app"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
    });

    expect(provider.postExpand).toBeUndefined();
  });

  it("wires contributeMetadata when provided", () => {
    const provider = defineProvider<FakeExtension>({
      name: "with-meta",
      ownedNamespaces: [],
      template: { name: "T", params: ["app"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
      contributeMetadata(data) {
        return { permissionsByApp: { [data[0]?.app ?? "none"]: ["perm_a"] } };
      },
    });

    const contrib = provider.contributeMetadata!({
      data: [{ app: "myapp", action: "read" }] as unknown,
      warnings: [],
    });
    expect(contrib.permissionsByApp).toEqual({ myapp: ["perm_a"] });
  });

  it("omits contributeMetadata when not provided", () => {
    const provider = defineProvider<FakeExtension>({
      name: "no-meta",
      ownedNamespaces: [],
      template: { name: "T", params: ["app"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
    });

    expect(provider.contributeMetadata).toBeUndefined();
  });

  it("expand receives typed data from discovery result", () => {
    let receivedData: FakeExtension[] = [];

    const provider = defineProvider<FakeExtension>({
      name: "typed-expand",
      ownedNamespaces: [],
      template: { name: "T", params: ["app", "action"] },
      expand(resources, data) {
        receivedData = data;
        return { resources, warnings: [] };
      },
    });

    const fakeDiscovery = {
      data: [{ app: "inventory", action: "read" }],
      warnings: [],
    };
    const resources: ResourceDef[] = [{ name: "host", namespace: "inventory", relations: [] }];

    const result: ProviderExpansionResult = provider.expand(resources, fakeDiscovery);
    expect(receivedData).toEqual([{ app: "inventory", action: "read" }]);
    expect(result.resources).toHaveLength(1);
  });

  it("filter is applied during discovery to exclude non-matching results", () => {
    let expandCalledWith: FakeExtension[] = [];

    const provider = defineProvider<FakeExtension>({
      name: "with-filter",
      ownedNamespaces: [],
      template: {
        name: "T",
        params: ["app", "action"],
        filter: (p) => p.action === "read",
      },
      expand(resources, data) {
        expandCalledWith = data;
        return { resources, warnings: [] };
      },
    });

    const fakeDiscovery = {
      data: [
        { app: "inv", action: "read" },
        { app: "inv", action: "explode" },
      ],
      warnings: [],
    };

    provider.expand([{ name: "x", namespace: "y", relations: [] }], fakeDiscovery);
    expect(expandCalledWith).toEqual([
      { app: "inv", action: "read" },
      { app: "inv", action: "explode" },
    ]);
  });

  it("returns the constructed KesselProvider", () => {
    const provider = defineProvider<FakeExtension>({
      name: "returns-provider",
      ownedNamespaces: ["rbac"],
      template: { name: "T", params: ["app"] },
      expand(resources) {
        return { resources, warnings: [] };
      },
    });

    expect(provider.name).toBe("returns-provider");
    expect(provider.ownedNamespaces).toEqual(["rbac"]);
    expect(typeof provider.discover).toBe("function");
    expect(typeof provider.expand).toBe("function");
  });
});
