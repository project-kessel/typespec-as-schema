import { describe, it, expect } from "vitest";
import { generateMetadata, type ResourceDef, type ExtensionProvider } from "../../src/lib.js";
import type { ProviderDiscoveryResult } from "../../src/pipeline.js";

const mockRbacProvider: ExtensionProvider = {
  id: "rbac",
  templates: [],
  discover: () => [],
  expand: (r) => ({ resources: r, warnings: [] }),
  applicationParamKey: "application",
  permissionParamKey: "v2Perm",
};

const defaultProviderMap = new Map<string, ExtensionProvider>([["rbac", mockRbacProvider]]);

function wrapAsProviderResults(...discovered: { application: string; resource: string; verb: string; v2Perm: string }[]): ProviderDiscoveryResult[] {
  return [{
    providerId: "rbac",
    discovered: discovered.map((d) => ({
      kind: "V1WorkspacePermission",
      params: d,
    })),
  }];
}

describe("generateMetadata", () => {
  const inventoryDiscovered = [
    { application: "inventory", resource: "hosts", verb: "read", v2Perm: "inventory_host_view" },
    { application: "inventory", resource: "hosts", verb: "write", v2Perm: "inventory_host_update" },
  ];

  const remediationsDiscovered = [
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
    const providerResults = wrapAsProviderResults(...inventoryDiscovered, ...remediationsDiscovered);
    const metadata = generateMetadata([], providerResults, defaultProviderMap);

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
    const providerResults = wrapAsProviderResults(...inventoryDiscovered);
    const metadata = generateMetadata([inventoryResource], providerResults, defaultProviderMap);
    expect(metadata.inventory.resources).toContain("host");
  });

  it("excludes RBAC resources from metadata", () => {
    const rbacResource: ResourceDef = {
      name: "role",
      namespace: "rbac",
      relations: [],
    };
    const providerResults = wrapAsProviderResults(...inventoryDiscovered);
    const metadata = generateMetadata([rbacResource, inventoryResource], providerResults, defaultProviderMap, new Set(["rbac"]));
    expect(metadata.rbac).toBeUndefined();
  });

  it("permissions-only service has empty resources array", () => {
    const providerResults = wrapAsProviderResults(...remediationsDiscovered);
    const metadata = generateMetadata([], providerResults, defaultProviderMap);
    expect(metadata.remediations.resources).toEqual([]);
  });

  it("produces the expected benchmark metadata structure", () => {
    const providerResults = wrapAsProviderResults(...inventoryDiscovered, ...remediationsDiscovered);
    const metadata = generateMetadata([inventoryResource], providerResults, defaultProviderMap);

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
