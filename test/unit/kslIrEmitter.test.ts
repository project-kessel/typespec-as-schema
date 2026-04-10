import { describe, it, expect } from "vitest";
import { generateKslIR } from "../../src/ksl-ir-emitter.js";
import type { ResourceDef, V1Extension } from "../../src/lib.js";

const sampleResources: ResourceDef[] = [
  {
    name: "host",
    namespace: "inventory",
    relations: [
      { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
      { name: "view", body: { kind: "subref", name: "t_workspace", subname: "inventory_host_view" } },
      { name: "update", body: { kind: "subref", name: "t_workspace", subname: "inventory_host_update" } },
    ],
  },
  { name: "principal", namespace: "rbac", relations: [] },
  {
    name: "role",
    namespace: "rbac",
    relations: [
      { name: "any_any_any", body: { kind: "bool", target: "rbac/principal" } },
    ],
  },
];

const sampleExtensions: V1Extension[] = [
  { application: "inventory", resource: "hosts", verb: "read", v2Perm: "inventory_host_view" },
  { application: "inventory", resource: "hosts", verb: "write", v2Perm: "inventory_host_update" },
  { application: "remediations", resource: "remediations", verb: "read", v2Perm: "remediations_remediation_view" },
  { application: "remediations", resource: "remediations", verb: "write", v2Perm: "remediations_remediation_update" },
];

describe("generateKslIR", () => {
  it("excludes rbac namespace from output (rbac is defined in KSL, not TypeSpec)", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const names = namespaces.map((ns) => ns.name);
    expect(names).not.toContain("rbac");
  });

  it("emits inventory namespace with host type", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const inv = namespaces.find((ns) => ns.name === "inventory");
    expect(inv).toBeDefined();
    expect(inv!.types).toHaveLength(1);
    expect(inv!.types![0].name).toBe("host");
  });

  it("emits remediations as permissions-only namespace (no types)", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const rem = namespaces.find((ns) => ns.name === "remediations");
    expect(rem).toBeDefined();
    expect(rem!.types).toBeUndefined();
  });

  it("translates assignable body to KSL self kind", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const host = namespaces.find((ns) => ns.name === "inventory")!.types![0];
    const workspace = host.relations.find((r) => r.name === "workspace")!;
    expect(workspace.body.kind).toBe("self");
    expect(workspace.body.types).toEqual([{ namespace: "rbac", name: "workspace" }]);
    expect(workspace.body.cardinality).toBe("ExactlyOne");
  });

  it("translates subref body to KSL nested_reference kind (strips t_ prefix)", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const host = namespaces.find((ns) => ns.name === "inventory")!.types![0];
    const view = host.relations.find((r) => r.name === "view")!;
    expect(view.body.kind).toBe("nested_reference");
    expect(view.body.relation).toBe("workspace");
    expect(view.body.sub_relation).toBe("inventory_host_view");
  });

  it("emits extension references for inventory", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const inv = namespaces.find((ns) => ns.name === "inventory")!;
    expect(inv.extension_references).toBeDefined();

    const wpRefs = inv.extension_references!.filter((r) => r.name === "workspace_permission");
    expect(wpRefs).toHaveLength(2);
    expect(wpRefs[0].params!.full_name).toBe("inventory_host_view");
    expect(wpRefs[1].params!.full_name).toBe("inventory_host_update");
  });

  it("emits add_view_metadata only for read-verb extensions", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const inv = namespaces.find((ns) => ns.name === "inventory")!;
    const viewMetaRefs = inv.extension_references!.filter((r) => r.name === "add_view_metadata");
    expect(viewMetaRefs).toHaveLength(1);
    expect(viewMetaRefs[0].params!.full_name).toBe("inventory_host_view");
  });

  it("emits extension references for remediations", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    const rem = namespaces.find((ns) => ns.name === "remediations")!;
    expect(rem.extension_references).toBeDefined();

    const wpRefs = rem.extension_references!.filter((r) => r.name === "workspace_permission");
    expect(wpRefs).toHaveLength(2);
    expect(wpRefs[0].params!.full_name).toBe("remediations_remediation_view");
  });

  it("all non-rbac namespaces import rbac", () => {
    const namespaces = generateKslIR(sampleResources, sampleExtensions);
    for (const ns of namespaces) {
      expect(ns.imports).toContain("rbac");
    }
  });
});

describe("KSL IR body translation: set operations", () => {
  it("translates or (n-ary) to binary union tree", () => {
    const resources: ResourceDef[] = [{
      name: "role",
      namespace: "test",
      relations: [{
        name: "perm",
        body: {
          kind: "or",
          members: [
            { kind: "ref", name: "a" },
            { kind: "ref", name: "b" },
            { kind: "ref", name: "c" },
          ],
        },
      }],
    }];

    const namespaces = generateKslIR(resources, []);
    const body = namespaces[0].types![0].relations[0].body;
    expect(body.kind).toBe("union");
    expect(body.right!.kind).toBe("reference");
    expect(body.right!.relation).toBe("c");
    expect(body.left!.kind).toBe("union");
    expect(body.left!.left!.relation).toBe("a");
    expect(body.left!.right!.relation).toBe("b");
  });

  it("translates and (n-ary) to binary intersect tree", () => {
    const resources: ResourceDef[] = [{
      name: "binding",
      namespace: "test",
      relations: [{
        name: "perm",
        body: {
          kind: "and",
          members: [
            { kind: "ref", name: "subject" },
            { kind: "subref", name: "t_granted", subname: "view" },
          ],
        },
      }],
    }];

    const namespaces = generateKslIR(resources, []);
    const body = namespaces[0].types![0].relations[0].body;
    expect(body.kind).toBe("intersect");
    expect(body.left!.kind).toBe("reference");
    expect(body.left!.relation).toBe("subject");
    expect(body.right!.kind).toBe("nested_reference");
    expect(body.right!.relation).toBe("granted");
    expect(body.right!.sub_relation).toBe("view");
  });

  it("translates bool body to KSL self with all:true", () => {
    const resources: ResourceDef[] = [{
      name: "role",
      namespace: "test",
      relations: [{
        name: "wildcard",
        body: { kind: "bool", target: "rbac/principal" },
      }],
    }];

    const namespaces = generateKslIR(resources, []);
    const body = namespaces[0].types![0].relations[0].body;
    expect(body.kind).toBe("self");
    expect(body.types![0].all).toBe(true);
    expect(body.cardinality).toBe("All");
  });
});
