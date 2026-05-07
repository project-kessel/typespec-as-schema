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

  it("required data fields are not wrapped in oneOf with null", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [],
        dataFields: [
          { name: "name", required: true, schema: { type: "string" } },
          { name: "label", required: false, schema: { type: "string" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["inventory/host"].properties["name"]).toEqual({ type: "string" });
    expect(schemas["inventory/host"].properties["label"]).toEqual({
      oneOf: [{ type: "string" }, { type: "null" }],
    });
  });

  it("emits boolean data fields", () => {
    const resources: ResourceDef[] = [
      {
        name: "k8s_policy",
        namespace: "k8s",
        relations: [],
        dataFields: [
          { name: "disabled", required: true, schema: { type: "boolean" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["k8s/k8s_policy"].properties["disabled"]).toEqual({ type: "boolean" });
  });

  it("emits string enum data fields", () => {
    const resources: ResourceDef[] = [
      {
        name: "k8s_cluster",
        namespace: "k8s",
        relations: [],
        dataFields: [
          {
            name: "cluster_status",
            required: true,
            schema: { type: "string", enum: ["READY", "FAILED", "OFFLINE"] },
          },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    const prop = schemas["k8s/k8s_cluster"].properties["cluster_status"];
    expect(prop).toEqual({ type: "string", enum: ["READY", "FAILED", "OFFLINE"] });
  });

  it("emits integer data fields with bounds", () => {
    const resources: ResourceDef[] = [
      {
        name: "document",
        namespace: "drive",
        relations: [],
        dataFields: [
          { name: "file_size", required: false, schema: { type: "integer", minimum: 0 } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    const prop = schemas["drive/document"].properties["file_size"];
    expect(prop).toEqual({
      oneOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
    });
  });

  it("emits array data fields with items", () => {
    const resources: ResourceDef[] = [
      {
        name: "k8s_cluster",
        namespace: "k8s",
        relations: [],
        dataFields: [
          {
            name: "nodes",
            required: false,
            schema: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  cpu: { type: "string" },
                  memory: { type: "string" },
                },
                required: ["name", "cpu", "memory"],
              },
            },
          },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    const prop = schemas["k8s/k8s_cluster"].properties["nodes"];
    expect("oneOf" in prop).toBe(true);
    if ("oneOf" in prop) {
      expect(prop.oneOf).toHaveLength(2);
      const arraySchema = prop.oneOf[0];
      expect("type" in arraySchema && arraySchema.type).toBe("array");
      if ("items" in arraySchema && arraySchema.items) {
        expect("properties" in arraySchema.items).toBe(true);
      }
    }
  });

  it("emits number data fields", () => {
    const resources: ResourceDef[] = [
      {
        name: "sensor",
        namespace: "iot",
        relations: [],
        dataFields: [
          { name: "temperature", required: true, schema: { type: "number", minimum: -40, maximum: 85 } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["iot/sensor"].properties["temperature"]).toEqual({
      type: "number", minimum: -40, maximum: 85,
    });
  });

  it("emits date-time format on string fields", () => {
    const resources: ResourceDef[] = [
      {
        name: "document",
        namespace: "drive",
        relations: [],
        dataFields: [
          { name: "created_at", required: true, schema: { type: "string", format: "date-time" } },
        ],
      },
    ];

    const schemas = generateUnifiedJsonSchemas(resources);
    expect(schemas["drive/document"].properties["created_at"]).toEqual({
      type: "string", format: "date-time",
    });
  });
});
