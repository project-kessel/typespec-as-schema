import { describe, it, expect } from "vitest";
import {
  validatePermissionExpressions,
} from "../../src/safety.js";
import { slotName, type ResourceDef } from "../../src/lib.js";

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
