import { describe, it, expect, beforeEach } from "vitest";
import {
  registerProvider,
  getProviders,
  clearProviders,
  type KesselProvider,
  type ProviderDiscoveryResult,
  type ProviderExpansionResult,
  type MetadataContribution,
} from "../../src/provider-registry.js";
import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "../../src/types.js";

function makeStubProvider(name: string, ownedNamespaces: string[] = []): KesselProvider {
  return {
    name,
    ownedNamespaces,
    discover(_program: Program): ProviderDiscoveryResult {
      return { data: [`${name}-discovered`], warnings: [] };
    },
    expand(resources: ResourceDef[], _discovery: ProviderDiscoveryResult): ProviderExpansionResult {
      return { resources: [...resources], warnings: [] };
    },
  };
}

describe("provider-registry", () => {
  beforeEach(() => {
    clearProviders();
  });

  it("starts empty after clearProviders", () => {
    expect(getProviders()).toHaveLength(0);
  });

  it("registers and retrieves a provider", () => {
    const provider = makeStubProvider("test-provider");
    registerProvider(provider);
    expect(getProviders()).toHaveLength(1);
    expect(getProviders()[0].name).toBe("test-provider");
  });

  it("registers multiple providers in order", () => {
    registerProvider(makeStubProvider("alpha"));
    registerProvider(makeStubProvider("beta"));
    const names = getProviders().map((p) => p.name);
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("rejects duplicate provider names", () => {
    registerProvider(makeStubProvider("dup"));
    expect(() => registerProvider(makeStubProvider("dup"))).toThrow(
      'Provider "dup" is already registered',
    );
  });

  it("provider discover returns data", () => {
    const provider = makeStubProvider("test");
    registerProvider(provider);
    const result = provider.discover(null as unknown as Program);
    expect(result.data).toEqual(["test-discovered"]);
  });

  it("provider expand passes resources through", () => {
    const provider = makeStubProvider("test");
    const resources: ResourceDef[] = [
      { name: "widget", namespace: "app", relations: [] },
    ];
    const discovery: ProviderDiscoveryResult = { data: null, warnings: [] };
    const result = provider.expand(resources, discovery);
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0].name).toBe("widget");
  });

  it("optional postExpand is respected when present", () => {
    const provider: KesselProvider = {
      ...makeStubProvider("with-post"),
      postExpand(resources: ResourceDef[]): ResourceDef[] {
        return [...resources, { name: "added", namespace: "post", relations: [] }];
      },
    };
    registerProvider(provider);

    const resources: ResourceDef[] = [{ name: "original", namespace: "app", relations: [] }];
    const result = provider.postExpand!(resources);
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe("added");
  });

  it("optional contributeMetadata is respected when present", () => {
    const provider: KesselProvider = {
      ...makeStubProvider("with-meta"),
      contributeMetadata(_discovery: ProviderDiscoveryResult): MetadataContribution {
        return { permissionsByApp: { myapp: ["perm_a", "perm_b"] } };
      },
    };
    registerProvider(provider);

    const contribution = provider.contributeMetadata!({ data: null, warnings: [] });
    expect(contribution.permissionsByApp.myapp).toEqual(["perm_a", "perm_b"]);
  });

  it("ownedNamespaces are collected across providers", () => {
    registerProvider(makeStubProvider("rbac", ["rbac"]));
    registerProvider(makeStubProvider("notifications", ["notifications"]));

    const allOwned = new Set<string>();
    for (const p of getProviders()) {
      for (const ns of p.ownedNamespaces) allOwned.add(ns);
    }
    expect(allOwned).toEqual(new Set(["rbac", "notifications"]));
  });
});
