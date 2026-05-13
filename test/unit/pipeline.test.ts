import { describe, it, expect } from "vitest";
import { compilePipeline } from "../../src/pipeline.js";
import { SchemaComplexityError, OutputSizeError, DiscoveryTimeoutError, ExpansionTimeoutError } from "../../src/safety.js";
import { mainTsp, DEFAULT_TEST_PROVIDERS, allDiscovered } from "../helpers/pipeline.js";
import type { ExtensionProvider } from "../../src/provider.js";

const providers = DEFAULT_TEST_PROVIDERS;

describe("compilePipeline with PipelineOptions", () => {
  it("produces a valid result with default options", async () => {
    const result = await compilePipeline(mainTsp, { providers });
    expect(result.resources.length).toBeGreaterThan(0);
    expect(allDiscovered(result).length).toBeGreaterThan(0);
    expect(result.fullSchema.length).toBeGreaterThan(0);
    expect(typeof result.spicedbOutput).toBe("string");
    expect(result.spicedbOutput.length).toBeGreaterThan(0);
    expect(result.diagnostics).toBeDefined();
    expect(result.warnings).toBeDefined();
  }, 30_000);

  it("throws SchemaComplexityError when maxExpansionCost is too low", async () => {
    await expect(
      compilePipeline(mainTsp, { providers, limits: { maxExpansionCost: 1 } }),
    ).rejects.toThrow(SchemaComplexityError);
  }, 30_000);

  it("throws OutputSizeError when outputMaxBytes is too low", async () => {
    await expect(
      compilePipeline(mainTsp, { providers, limits: { outputMaxBytes: 10 } }),
    ).rejects.toThrow(OutputSizeError);
  }, 30_000);

  it("emits a warning when outputWarnBytes is exceeded", async () => {
    const result = await compilePipeline(mainTsp, { providers, limits: { outputWarnBytes: 10 } });
    expect(result.warnings.some((w) => w.includes("SpiceDB schema is"))).toBe(true);
  }, 30_000);

  it("collects expansion warnings as data (no console.error side effects)", async () => {
    const result = await compilePipeline(mainTsp, { providers });
    expect(Array.isArray(result.warnings)).toBe(true);
  }, 30_000);

  it("throws on duplicate provider IDs", async () => {
    const duped = [...providers, providers[0]];
    await expect(
      compilePipeline(mainTsp, { providers: duped }),
    ).rejects.toThrow(/Duplicate provider ID/);
  });

  it("exposes preExpansionDiagnostics on the result", async () => {
    const result = await compilePipeline(mainTsp, { providers });
    expect(Array.isArray(result.preExpansionDiagnostics)).toBe(true);
  }, 30_000);

  it("throws ExpansionTimeoutError when a provider expand() is slow", async () => {
    const slowExpander: ExtensionProvider = {
      id: "slow_expand",
      templates: [],
      discover: () => [],
      expand(r) {
        const start = performance.now();
        while (performance.now() - start < 50) { /* busy wait */ }
        return { resources: r, warnings: [] };
      },
    };
    await expect(
      compilePipeline(mainTsp, { providers: [slowExpander], limits: { expansionTimeoutMs: 1 } }),
    ).rejects.toThrow(ExpansionTimeoutError);
  }, 30_000);

  it("throws DiscoveryTimeoutError when a provider discover() is slow", async () => {
    const slowProvider: ExtensionProvider = {
      id: "slow",
      templates: [],
      discover(_program) {
        const start = performance.now();
        while (performance.now() - start < 50) { /* busy wait */ }
        return [];
      },
      expand(r) { return { resources: r, warnings: [] }; },
    };
    await expect(
      compilePipeline(mainTsp, { providers: [...providers, slowProvider], limits: { discoveryTimeoutMs: 1 } }),
    ).rejects.toThrow(DiscoveryTimeoutError);
  }, 30_000);
});

describe("multi-provider interaction", () => {
  it("runs multiple providers and includes results from each", async () => {
    const { createNoopProvider } = await import("../helpers/mock-provider.js");
    const noopProvider = createNoopProvider("noop");
    const result = await compilePipeline(mainTsp, { providers: [...providers, noopProvider] });
    expect(result.providerResults.length).toBe(providers.length + 1);
    expect(result.providerResults.map((pr) => pr.providerId)).toContain("rbac");
    expect(result.providerResults.map((pr) => pr.providerId)).toContain("hbi");
    expect(result.providerResults.map((pr) => pr.providerId)).toContain("noop");
  }, 30_000);

  it("respects provider ordering — first provider expands first", async () => {
    const { createNoopProvider } = await import("../helpers/mock-provider.js");
    const tracker: string[] = [];
    const trackingProviderA: ExtensionProvider = {
      id: "track_a",
      templates: [],
      discover: () => { tracker.push("discover_a"); return []; },
      expand: (r) => { tracker.push("expand_a"); return { resources: r, warnings: [] }; },
    };
    const trackingProviderB: ExtensionProvider = {
      id: "track_b",
      templates: [],
      discover: () => { tracker.push("discover_b"); return []; },
      expand: (r) => { tracker.push("expand_b"); return { resources: r, warnings: [] }; },
    };
    await compilePipeline(mainTsp, { providers: [trackingProviderA, trackingProviderB] });
    expect(tracker).toEqual(["discover_a", "discover_b", "expand_a", "expand_b"]);
  }, 30_000);
});
