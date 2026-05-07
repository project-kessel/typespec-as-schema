import { describe, it, expect } from "vitest";
import {
  generateUnifiedJsonSchemas,
  slotName,
  type ResourceDef,
} from "../../src/lib.js";

describe("generateUnifiedJsonSchemas", () => {
  it("generates _id field for ExactlyOne assignable relation", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
          { name: "view", body: { kind: "subref", name: slotName("workspace"), subname: "inventory_host_view" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["inventory/host"]).toBeDefined();

    const schema = schemas["inventory/host"];
    expect(schema.$id).toBe("inventory/host");
    expect(schema.type).toBe("object");
    expect(schema.properties.workspace_id).toBeDefined();
    expect(schema.properties.workspace_id.type).toBe("string");
    expect(schema.properties.workspace_id.format).toBe("uuid");
    expect(schema.required).toContain("workspace_id");
  });

  it("does not generate _id field for AtMostOne cardinality", () => {
    const resources: ResourceDef[] = [
      {
        name: "workspace",
        namespace: "rbac",
        relations: [
          { name: "parent", body: { kind: "assignable", target: "rbac/workspace", cardinality: "AtMostOne" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["rbac/workspace"]).toBeUndefined();
  });

  it("skips RBAC namespace resources", () => {
    const resources: ResourceDef[] = [
      {
        name: "role",
        namespace: "rbac",
        relations: [
          { name: "something", body: { kind: "assignable", target: "rbac/principal", cardinality: "ExactlyOne" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources, new Set(["rbac"]));
    expect(Object.keys(schemas)).toHaveLength(0);
  });

  it("skips resources with no ExactlyOne relations", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "Any" } },
          { name: "view", body: { kind: "ref", name: slotName("workspace") } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["inventory/host"]).toBeUndefined();
  });

  it("includes source provenance in property", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    const prop = schemas["inventory/host"].properties.workspace_id;
    expect("source" in prop && prop.source)
      .toBe("relation workspace: rbac/workspace [ExactlyOne]");
  });

  it("includes data fields in schema properties", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
        ],
        dataFields: [
          { name: "ansible_host", required: false, schema: { type: "string", maxLength: 255 } },
          { name: "insights_id", required: false, schema: { type: "string", format: "uuid" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    const schema = schemas["inventory/host"];
    expect(schema.properties["ansible_host"]).toEqual({
      oneOf: [{ type: "string", maxLength: 255 }, { type: "null" }],
    });
    expect(schema.properties["insights_id"]).toEqual({
      oneOf: [{ type: "string", format: "uuid" }, { type: "null" }],
    });
    expect(schema.required).not.toContain("ansible_host");
    expect(schema.required).not.toContain("insights_id");
  });

  it("includes required data fields in required array", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [],
        dataFields: [
          { name: "name", required: true, schema: { type: "string" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    const schema = schemas["inventory/host"];
    expect(schema.required).toContain("name");
  });

  it("emits oneOf for union data fields", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [],
        dataFields: [
          {
            name: "satellite_id",
            required: false,
            schema: {
              oneOf: [
                { type: "string" },
                { type: "string", pattern: "^\\d{10}$" },
              ],
            },
          },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    const prop = schemas["inventory/host"].properties["satellite_id"];
    expect("oneOf" in prop).toBe(true);
    if ("oneOf" in prop) {
      expect(prop.oneOf).toHaveLength(3);
      expect(prop.oneOf[prop.oneOf.length - 1]).toEqual({ type: "null" });
    }
  });

  it("emits schema for resources with only data fields (no relations)", () => {
    const resources: ResourceDef[] = [
      {
        name: "config",
        namespace: "myapp",
        relations: [],
        dataFields: [
          { name: "key", required: true, schema: { type: "string" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["myapp/config"]).toBeDefined();
    expect(schemas["myapp/config"].properties["key"]).toEqual({ type: "string" });
  });
});
