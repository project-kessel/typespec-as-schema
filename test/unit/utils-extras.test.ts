import { describe, it, expect } from "vitest";
import {
  slotName,
  flattenAnnotations,
  findResource,
  cloneResources,
  isAssignable,
  type ResourceDef,
  type RelationBody,
} from "../../src/lib.js";

describe("slotName", () => {
  it("prefixes a name with t_", () => {
    expect(slotName("foo")).toBe("t_foo");
  });

  it("handles empty string", () => {
    expect(slotName("")).toBe("t_");
  });

  it("handles underscored names", () => {
    expect(slotName("any_any_any")).toBe("t_any_any_any");
  });
});

describe("flattenAnnotations", () => {
  it("returns correct nested record for populated map", () => {
    const annotations = new Map<string, { key: string; value: string }[]>();
    annotations.set("inventory/host", [
      { key: "feature_flag", value: "staleness_v2" },
      { key: "retention_days", value: "90" },
    ]);
    const result = flattenAnnotations(annotations);
    expect(result).toEqual({
      "inventory/host": {
        feature_flag: "staleness_v2",
        retention_days: "90",
      },
    });
  });

  it("returns empty object for empty map", () => {
    expect(flattenAnnotations(new Map())).toEqual({});
  });

  it("handles multiple resource keys", () => {
    const annotations = new Map<string, { key: string; value: string }[]>();
    annotations.set("inventory/host", [{ key: "a", value: "1" }]);
    annotations.set("remediations/remediation", [{ key: "b", value: "2" }]);
    const result = flattenAnnotations(annotations);
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["inventory/host"].a).toBe("1");
    expect(result["remediations/remediation"].b).toBe("2");
  });
});

describe("findResource", () => {
  const resources: ResourceDef[] = [
    { name: "role", namespace: "rbac", relations: [] },
    { name: "host", namespace: "inventory", relations: [] },
    { name: "workspace", namespace: "rbac", relations: [] },
  ];

  it("finds a resource by namespace and name", () => {
    const result = findResource(resources, "rbac", "role");
    expect(result).toBeDefined();
    expect(result!.name).toBe("role");
    expect(result!.namespace).toBe("rbac");
  });

  it("returns undefined when not found", () => {
    expect(findResource(resources, "rbac", "nonexistent")).toBeUndefined();
  });

  it("distinguishes resources with the same name in different namespaces", () => {
    const mixed: ResourceDef[] = [
      { name: "host", namespace: "a", relations: [] },
      { name: "host", namespace: "b", relations: [] },
    ];
    expect(findResource(mixed, "a", "host")!.namespace).toBe("a");
    expect(findResource(mixed, "b", "host")!.namespace).toBe("b");
  });
});

describe("cloneResources", () => {
  it("returns a new array with new relation arrays", () => {
    const original: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
        ],
      },
    ];
    const cloned = cloneResources(original);
    expect(cloned).not.toBe(original);
    expect(cloned[0]).not.toBe(original[0]);
    expect(cloned[0].relations).not.toBe(original[0].relations);
    expect(cloned[0].relations).toEqual(original[0].relations);
  });

  it("mutations to cloned resources do not affect originals", () => {
    const original: ResourceDef[] = [
      { name: "host", namespace: "inventory", relations: [] },
    ];
    const cloned = cloneResources(original);
    cloned[0].relations.push({
      name: "added",
      body: { kind: "ref", name: "x" },
    });
    expect(original[0].relations).toHaveLength(0);
  });
});

describe("isAssignable", () => {
  it("returns true for assignable kind", () => {
    const body: RelationBody = { kind: "assignable", target: "rbac/workspace", cardinality: "Any" };
    expect(isAssignable(body)).toBe(true);
  });

  it("returns true for bool kind", () => {
    const body: RelationBody = { kind: "bool", target: "rbac/principal" };
    expect(isAssignable(body)).toBe(true);
  });

  it("returns false for ref kind", () => {
    const body: RelationBody = { kind: "ref", name: "subject" };
    expect(isAssignable(body)).toBe(false);
  });

  it("returns false for subref kind", () => {
    const body: RelationBody = { kind: "subref", name: "t_binding", subname: "perm" };
    expect(isAssignable(body)).toBe(false);
  });

  it("returns false for or kind", () => {
    const body: RelationBody = {
      kind: "or",
      members: [{ kind: "ref", name: "a" }, { kind: "ref", name: "b" }],
    };
    expect(isAssignable(body)).toBe(false);
  });

  it("returns false for and kind", () => {
    const body: RelationBody = {
      kind: "and",
      members: [{ kind: "ref", name: "a" }, { kind: "ref", name: "b" }],
    };
    expect(isAssignable(body)).toBe(false);
  });
});
