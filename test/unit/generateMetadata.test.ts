import { describe, it, expect } from "vitest";
import { generateMetadata, type ResourceDef } from "../../src/lib.js";
import type { MetadataContribution } from "../../src/provider-registry.js";

describe("generateMetadata", () => {
  const inventoryContribution: MetadataContribution = {
    permissionsByApp: {
      inventory: ["inventory_host_view", "inventory_host_update"],
    },
  };

  const remediationsContribution: MetadataContribution = {
    permissionsByApp: {
      remediations: ["remediations_remediation_view", "remediations_remediation_update"],
    },
  };

  const inventoryResource: ResourceDef = {
    name: "host",
    namespace: "inventory",
    relations: [
      { name: "workspace", body: { kind: "assignable", target: "rbac/workspace", cardinality: "ExactlyOne" } },
    ],
  };

  it("groups permissions by application", () => {
    const contributions = [inventoryContribution, remediationsContribution];
    const metadata = generateMetadata([], contributions);

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
    const metadata = generateMetadata([inventoryResource], [inventoryContribution]);
    expect(metadata.inventory.resources).toContain("host");
  });

  it("excludes RBAC resources from metadata", () => {
    const rbacResource: ResourceDef = {
      name: "role",
      namespace: "rbac",
      relations: [],
    };
    const metadata = generateMetadata([rbacResource, inventoryResource], [inventoryContribution], new Set(["rbac"]));
    expect(metadata.rbac).toBeUndefined();
  });

  it("permissions-only service has empty resources array", () => {
    const metadata = generateMetadata([], [remediationsContribution]);
    expect(metadata.remediations.resources).toEqual([]);
  });

  it("produces the expected benchmark metadata structure", () => {
    const contributions = [inventoryContribution, remediationsContribution];
    const metadata = generateMetadata([inventoryResource], contributions);

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
