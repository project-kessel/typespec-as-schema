import { describe, it, expect } from "vitest";
import { generateSpiceDB, type ResourceDef } from "../../emitter/lib.js";

describe("generateSpiceDB", () => {
  it("generates an empty definition for a resource with no relations", () => {
    const resources: ResourceDef[] = [
      { name: "principal", namespace: "rbac", relations: [] },
    ];
    const output = generateSpiceDB(resources);
    expect(output).toContain("definition rbac/principal {");
    expect(output).toContain("}");
  });

  it("generates t_ prefixed relations for assignable relations", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
        ],
      },
    ];
    const output = generateSpiceDB(resources);
    expect(output).toContain("relation t_workspace: rbac/workspace");
    expect(output).toContain("permission workspace = t_workspace");
  });

  it("generates t_ prefixed relations for bool relations", () => {
    const resources: ResourceDef[] = [
      {
        name: "role",
        namespace: "rbac",
        relations: [
          { name: "any_any_any", body: { kind: "bool", target: "rbac/principal" } },
        ],
      },
    ];
    const output = generateSpiceDB(resources);
    expect(output).toContain("relation t_any_any_any: rbac/principal:*");
    expect(output).toContain("permission any_any_any = t_any_any_any");
  });

  it("generates computed permissions", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
          { name: "view", body: { kind: "subref", name: "t_workspace", subname: "inventory_host_view" } },
        ],
      },
    ];
    const output = generateSpiceDB(resources);
    expect(output).toContain("permission view = t_workspace->inventory_host_view");
  });

  it("generates intersection permissions with parentheses", () => {
    const resources: ResourceDef[] = [
      {
        name: "role_binding",
        namespace: "rbac",
        relations: [
          { name: "subject", body: { kind: "assignable", target: "rbac/principal", cardinality: "Any" } },
          { name: "granted", body: { kind: "assignable", target: "rbac/role", cardinality: "Any" } },
          {
            name: "inventory_host_view",
            body: {
              kind: "and",
              members: [
                { kind: "ref", name: "subject" },
                { kind: "subref", name: "t_granted", subname: "inventory_host_view" },
              ],
            },
          },
        ],
      },
    ];
    const output = generateSpiceDB(resources);
    expect(output).toContain("permission inventory_host_view = (subject & t_granted->inventory_host_view)");
  });

  it("generates union permissions", () => {
    const resources: ResourceDef[] = [
      {
        name: "workspace",
        namespace: "rbac",
        relations: [
          { name: "parent", body: { kind: "assignable", target: "rbac/workspace", cardinality: "AtMostOne" } },
          { name: "binding", body: { kind: "assignable", target: "rbac/role_binding", cardinality: "Any" } },
          {
            name: "inventory_host_view",
            body: {
              kind: "or",
              members: [
                { kind: "subref", name: "t_binding", subname: "inventory_host_view" },
                { kind: "subref", name: "t_parent", subname: "inventory_host_view" },
              ],
            },
          },
        ],
      },
    ];
    const output = generateSpiceDB(resources);
    expect(output).toContain("permission inventory_host_view = t_binding->inventory_host_view + t_parent->inventory_host_view");
  });

  it("outputs permissions before relations within a definition", () => {
    const resources: ResourceDef[] = [
      {
        name: "host",
        namespace: "inventory",
        relations: [
          { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
          { name: "view", body: { kind: "subref", name: "t_workspace", subname: "inventory_host_view" } },
        ],
      },
    ];
    const output = generateSpiceDB(resources);
    const permIdx = output.indexOf("permission workspace");
    const relIdx = output.indexOf("relation t_workspace");
    expect(permIdx).toBeLessThan(relIdx);
  });

  it("generates multiple definitions", () => {
    const resources: ResourceDef[] = [
      { name: "principal", namespace: "rbac", relations: [] },
      {
        name: "role",
        namespace: "rbac",
        relations: [
          { name: "any_any_any", body: { kind: "bool", target: "rbac/principal" } },
        ],
      },
    ];
    const output = generateSpiceDB(resources);
    expect(output).toContain("definition rbac/principal {");
    expect(output).toContain("definition rbac/role {");
  });
});
