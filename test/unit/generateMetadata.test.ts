import { describe, it, expect } from "vitest";
import { generateMetadata, type ResourceDef } from "../../src/lib.js";
import type { V1Extension } from "../../src/providers/rbac/rbac-provider.js";

describe("generateMetadata", () => {
  const inventoryPermissions: V1Extension[] = [
    { application: "inventory", resource: "hosts", verb: "read", v2Perm: "inventory_host_view" },
    { application: "inventory", resource: "hosts", verb: "write", v2Perm: "inventory_host_update" },
  ];

  const remediationsPermissions: V1Extension[] = [
    { application: "remediations", resource: "remediations", verb: "read", v2Perm: "remediations_remediation_view" },
    { application: "remediations", resource: "remediations", verb: "write", v2Perm: "remediations_remediation_update" },
  ];

  const inventoryResource: ResourceDef = {
    name: "host",
    namespace: "inventory",
    relations: [
      { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
    ],
  };

  it("groups permissions by application", () => {
    const allPerms = [...inventoryPermissions, ...remediationsPermissions];
    const metadata = generateMetadata([], allPerms);

    expect(metadata.inventory.permissions).toEqual([
      "inventory_host_view",
      "inventory_host_update",
    ]);
    expect(metadata.remediations.permissions).toEqual([
      "remediations_remediation_view",
      "remediations_remediation_update",
    ]);
  });

  it("includes resource names for non-RBAC resources", () => {
    const metadata = generateMetadata([inventoryResource], inventoryPermissions);
    expect(metadata.inventory.resources).toContain("host");
  });

  it("excludes RBAC resources from metadata", () => {
    const rbacResource: ResourceDef = {
      name: "role",
      namespace: "rbac",
      relations: [],
    };
    const metadata = generateMetadata([rbacResource, inventoryResource], inventoryPermissions, new Set(["rbac"]));
    expect(metadata.rbac).toBeUndefined();
  });

  it("permissions-only service has empty resources array", () => {
    const metadata = generateMetadata([], remediationsPermissions);
    expect(metadata.remediations.resources).toEqual([]);
  });

  it("produces the expected benchmark metadata structure", () => {
    const allPerms = [...inventoryPermissions, ...remediationsPermissions];
    const metadata = generateMetadata([inventoryResource], allPerms);

    expect(metadata).toEqual({
      inventory: {
        permissions: ["inventory_host_view", "inventory_host_update"],
        resources: ["host"],
      },
      remediations: {
        permissions: ["remediations_remediation_view", "remediations_remediation_update"],
        resources: [],
      },
    });
  });
});
