import { describe, it, expect } from "vitest";
import {
  validateProviderComplexityBudget,
  withExpansionTimeout,
  validateOutputSize,
  validatePermissionExpressions,
  SchemaComplexityError,
  OutputSizeError,
  DEFAULT_LIMITS,
} from "../../src/safety.js";
import { slotName, type ResourceDef } from "../../src/lib.js";
import type { DiscoveredExtension, ExtensionProvider } from "../../src/provider.js";

function mockProvider(overrides?: Partial<ExtensionProvider>): ExtensionProvider {
  return {
    id: "test",
    templates: [],
    discover: () => [],
    expand: () => ({ resources: [], warnings: [] }),
    costPerInstance: 1,
    ...overrides,
  };
}

function makeDiscovered(count: number): DiscoveredExtension[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "TestExtension",
    params: { application: `app${i}`, resource: "res", verb: "read", v2Perm: `app${i}_res_view` },
  }));
}

// ─── Complexity Budget ──────────────────────────────────────────────

describe("validateProviderComplexityBudget", () => {
  it("passes when extension count is within limit", () => {
    const discovered = makeDiscovered(1);
    expect(() => validateProviderComplexityBudget(discovered, mockProvider())).not.toThrow();
  });

  it("passes with zero extensions", () => {
    expect(() => validateProviderComplexityBudget([], mockProvider())).not.toThrow();
  });

  it("throws SchemaComplexityError when limit exceeded", () => {
    const discovered = makeDiscovered(3);
    const limits = { ...DEFAULT_LIMITS, maxExpansionCost: 2 };
    expect(() => validateProviderComplexityBudget(discovered, mockProvider(), limits)).toThrow(SchemaComplexityError);
  });

  it("error message includes counts and providerId", () => {
    expect.assertions(4);
    const discovered = makeDiscovered(5);
    const limits = { ...DEFAULT_LIMITS, maxExpansionCost: 3 };
    try {
      validateProviderComplexityBudget(discovered, mockProvider(), limits);
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaComplexityError);
      expect((e as SchemaComplexityError).providerId).toBe("test");
      expect((e as SchemaComplexityError).extensionCount).toBe(5);
      expect((e as SchemaComplexityError).limit).toBe(3);
    }
  });

  it("respects costPerInstance on the provider", () => {
    const discovered = makeDiscovered(2);
    const provider = mockProvider({ costPerInstance: 5 });
    const limits = { ...DEFAULT_LIMITS, maxExpansionCost: 9 };
    expect(() => validateProviderComplexityBudget(discovered, provider, limits)).toThrow(SchemaComplexityError);
  });
});

// ─── Expansion Timeout ──────────────────────────────────────────────
// Tests deprecated API for backward compat.
// The canonical timeout path is now inlined in compilePipeline and covered
// by test/unit/pipeline.test.ts.

describe("withExpansionTimeout (deprecated)", () => {
  it("returns result when expansion completes within timeout", () => {
    const result = withExpansionTimeout(() => 42);
    expect(result).toBe(42);
  });

  it("passes through the function's return value", () => {
    const result = withExpansionTimeout(() => [1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });
});

// ─── Output Size Validation ─────────────────────────────────────────

describe("validateOutputSize", () => {
  it("returns null warning for small output", () => {
    const result = validateOutputSize("small output");
    expect(result.warning).toBeNull();
  });

  it("returns warning for output exceeding warn threshold", () => {
    const limits = { ...DEFAULT_LIMITS, outputWarnBytes: 10 };
    const result = validateOutputSize("this is larger than 10 bytes", limits);
    expect(result.warning).not.toBeNull();
  });

  it("throws OutputSizeError for output exceeding max threshold", () => {
    const limits = { ...DEFAULT_LIMITS, outputMaxBytes: 5 };
    expect(() => validateOutputSize("longer than 5 bytes", limits)).toThrow(OutputSizeError);
  });

  it("error includes size details", () => {
    expect.assertions(2);
    const limits = { ...DEFAULT_LIMITS, outputMaxBytes: 5 };
    try {
      validateOutputSize("longer than 5", limits);
    } catch (e) {
      expect(e).toBeInstanceOf(OutputSizeError);
      expect((e as OutputSizeError).sizeBytes).toBeGreaterThan(5);
    }
  });
});

// ─── Permission Expression Validation ───────────────────────────────

describe("validatePermissionExpressions", () => {
  it("returns no diagnostics for valid schema", () => {
    const resources: ResourceDef[] = [
      {
        name: "workspace",
        namespace: "rbac",
        relations: [
          { name: "parent", body: { kind: "assignable", target: "rbac/workspace", cardinality: "AtMostOne" } },
          { name: "binding", body: { kind: "assignable", target: "rbac/role_binding", cardinality: "Any" } },
          { name: "some_perm", body: { kind: "or", members: [
            { kind: "subref", name: slotName("binding"), subname: "some_perm" },
            { kind: "subref", name: slotName("parent"), subname: "some_perm" },
          ] } },
        ],
      },
      {
        name: "role_binding",
        namespace: "rbac",
        relations: [
          { name: "subject", body: { kind: "assignable", target: "rbac/principal", cardinality: "Any" } },
          { name: "some_perm", body: { kind: "ref", name: "subject" } },
        ],
      },
    ];
    const diagnostics = validatePermissionExpressions(resources);
    expect(diagnostics).toHaveLength(0);
  });

  it("detects unknown ref in permission expression", () => {
    const resources: ResourceDef[] = [
      {
        name: "role",
        namespace: "rbac",
        relations: [
          { name: "any_any_any", body: { kind: "bool", target: "rbac/principal" } },
          { name: "bad_perm", body: { kind: "ref", name: "nonexistent_relation" } },
        ],
      },
    ];
    const diagnostics = validatePermissionExpressions(resources);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("nonexistent_relation");
  });

  it("detects unknown subref target on resolved type", () => {
    const resources: ResourceDef[] = [
      {
        name: "workspace",
        namespace: "rbac",
        relations: [
          { name: "binding", body: { kind: "assignable", target: "rbac/role_binding", cardinality: "Any" } },
          { name: "bad_perm", body: { kind: "subref", name: slotName("binding"), subname: "totally_fake_perm" } },
        ],
      },
      {
        name: "role_binding",
        namespace: "rbac",
        relations: [
          { name: "subject", body: { kind: "assignable", target: "rbac/principal", cardinality: "Any" } },
        ],
      },
    ];
    const diagnostics = validatePermissionExpressions(resources);
    expect(diagnostics.some((d) => d.message.includes("totally_fake_perm"))).toBe(true);
  });

  it("passes for assignable and bool bodies (they define, not reference)", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
        ],
      },
    ];
    const diagnostics = validatePermissionExpressions(resources);
    expect(diagnostics).toHaveLength(0);
  });

  it("detects subref to permission that doesn't exist on resolved target type", () => {
    const resources: ResourceDef[] = [
      {
        name: "workspace",
        namespace: "rbac",
        relations: [
          { name: "binding", body: { kind: "assignable", target: "rbac/role_binding", cardinality: "Any" } },
          { name: "view", body: { kind: "ref", name: "binding" } },
        ],
      },
      {
        name: "role_binding",
        namespace: "rbac",
        relations: [
          { name: "subject", body: { kind: "assignable", target: "rbac/principal", cardinality: "Any" } },
        ],
      },
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
          { name: "bad_perm", body: { kind: "subref", name: slotName("workspace"), subname: "nonexistent_on_workspace" } },
        ],
      },
    ];
    const diagnostics = validatePermissionExpressions(resources);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("nonexistent_on_workspace");
    expect(diagnostics[0].message).toContain("rbac/workspace");
  });

  it("skips subref validation when target type is not in schema (external type)", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "external/service", cardinality: "ExactlyOne" } },
          { name: "view", body: { kind: "subref", name: slotName("workspace"), subname: "some_perm" } },
        ],
      },
    ];
    const diagnostics = validatePermissionExpressions(resources);
    expect(diagnostics).toHaveLength(0);
  });
});
