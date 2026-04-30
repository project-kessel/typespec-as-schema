import { describe, it, expect } from "vitest";
import { generateIR, IR_VERSION, slotName, type ResourceDef, type V1Extension } from "../../src/lib.js";

const sampleResources: ResourceDef[] = [
  {
    name: "host",
    namespace: "inventory",
    relations: [
      { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
      { name: "view", body: { kind: "subref", name: slotName("workspace"), subname: "inventory_host_view" } },
    ],
  },
];

const sampleExtensions: V1Extension[] = [
  { application: "inventory", resource: "hosts", verb: "read", v2Perm: "inventory_host_view" },
];

describe("generateIR", () => {
  it("produces all required top-level fields", () => {
    const ir = generateIR("schema/main.tsp", sampleResources, sampleExtensions);
    expect(ir.version).toBe(IR_VERSION);
    expect(ir.generatedAt).toBeDefined();
    expect(ir.source).toBe("schema/main.tsp");
    expect(ir.resources).toBe(sampleResources);
    expect(ir.extensions).toBe(sampleExtensions);
    expect(typeof ir.spicedb).toBe("string");
    expect(ir.spicedb).toContain("definition inventory/host");
    expect(ir.metadata).toBeDefined();
    expect(ir.jsonSchemas).toBeDefined();
  });

  it("generatedAt is a valid ISO timestamp", () => {
    const ir = generateIR("test.tsp", sampleResources, sampleExtensions);
    const date = new Date(ir.generatedAt);
    expect(date.getTime()).not.toBeNaN();
  });

  it("includes annotations when provided", () => {
    const annotations = new Map<string, { key: string; value: string }[]>();
    annotations.set("inventory/host", [
      { key: "feature_flag", value: "staleness_v2" },
      { key: "retention_days", value: "90" },
    ]);
    const ir = generateIR("test.tsp", sampleResources, sampleExtensions, annotations);
    expect(ir.annotations).toBeDefined();
    expect(ir.annotations!["inventory/host"]["feature_flag"]).toBe("staleness_v2");
    expect(ir.annotations!["inventory/host"]["retention_days"]).toBe("90");
  });

  it("omits annotations when map is empty", () => {
    const emptyAnnotations = new Map<string, { key: string; value: string }[]>();
    const ir = generateIR("test.tsp", sampleResources, sampleExtensions, emptyAnnotations);
    expect(ir.annotations).toBeUndefined();
  });

  it("omits annotations when not provided", () => {
    const ir = generateIR("test.tsp", sampleResources, sampleExtensions);
    expect(ir.annotations).toBeUndefined();
  });

  it("embeds SpiceDB output from the same resources", () => {
    const ir = generateIR("test.tsp", sampleResources, sampleExtensions);
    expect(ir.spicedb).toContain(`permission view = ${slotName("workspace")}->inventory_host_view`);
    expect(ir.spicedb).toContain(`relation ${slotName("workspace")}: rbac/workspace`);
  });

  it("embeds metadata grouped by application", () => {
    const ir = generateIR("test.tsp", sampleResources, sampleExtensions);
    expect(ir.metadata.inventory).toBeDefined();
    expect(ir.metadata.inventory.permissions).toContain("inventory_host_view");
    expect(ir.metadata.inventory.resources).toContain("host");
  });

  it("embeds JSON schemas for non-RBAC resources with ExactlyOne relations", () => {
    const ir = generateIR("test.tsp", sampleResources, sampleExtensions);
    expect(ir.jsonSchemas["inventory/host"]).toBeDefined();
    expect(ir.jsonSchemas["inventory/host"].properties["workspace_id"]).toBeDefined();
  });
});
