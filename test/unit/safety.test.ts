import { describe, it, expect } from "vitest";
import {
  validateComplexityBudget,
  withExpansionTimeout,
  validateOutputSize,
  validatePermissionExpressions,
  SchemaComplexityError,
  OutputSizeError,
  DEFAULT_LIMITS,
} from "../../src/safety.js";
import { slotName, type V1Extension, type ResourceDef } from "../../src/lib.js";

// ─── Complexity Budget ──────────────────────────────────────────────

describe("validateComplexityBudget", () => {
  it("passes when extension count is within limit", () => {
    const extensions: V1Extension[] = [
      { application: "a", resource: "b", verb: "read", v2Perm: "a_b_view" },
    ];
    expect(() => validateComplexityBudget(extensions)).not.toThrow();
  });

  it("passes with zero extensions", () => {
    expect(() => validateComplexityBudget([])).not.toThrow();
  });

  it("throws SchemaComplexityError when limit exceeded", () => {
    const extensions: V1Extension[] = Array.from({ length: 3 }, (_, i) => ({
      application: `app${i}`,
      resource: "res",
      verb: "read",
      v2Perm: `app${i}_res_view`,
    }));
    const limits = { ...DEFAULT_LIMITS, maxExtensions: 2 };
    expect(() => validateComplexityBudget(extensions, limits)).toThrow(SchemaComplexityError);
  });

  it("error message includes counts", () => {
    expect.assertions(3);
    const extensions: V1Extension[] = Array.from({ length: 5 }, (_, i) => ({
      application: `app${i}`,
      resource: "res",
      verb: "read",
      v2Perm: `app${i}_res_view`,
    }));
    const limits = { ...DEFAULT_LIMITS, maxExtensions: 3 };
    try {
      validateComplexityBudget(extensions, limits);
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaComplexityError);
      expect((e as SchemaComplexityError).extensionCount).toBe(5);
      expect((e as SchemaComplexityError).limit).toBe(3);
    }
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
