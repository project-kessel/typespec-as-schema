import { describe, it, expect } from "vitest";
import { generatePreview } from "../../src/preview.js";
import {
  declaredExtensionsFromV1Extensions,
  V1_WORKSPACE_PERMISSION_TEMPLATE_RULES,
} from "../../src/declarative-extensions.js";
import type { V1Extension } from "../../src/lib.js";

function makeDeclared(exts: V1Extension[]) {
  return declaredExtensionsFromV1Extensions(exts);
}

describe("generatePreview", () => {
  it("returns a no-extensions message for empty input", () => {
    const output = generatePreview([]);
    expect(output).toContain("No V1WorkspacePermission extensions found");
  });

  it("shows a heading per alias with app/resource/verb label", () => {
    const declared = makeDeclared([
      { application: "inventory", resource: "host", verb: "read", v2Perm: "inventory_host_read" },
    ]);
    const output = generatePreview(declared);
    expect(output).toContain("inventory_host_read (inventory/host/read):");
  });

  it("shows bool relation additions from the template", () => {
    const declared = makeDeclared([
      { application: "inventory", resource: "host", verb: "read", v2Perm: "inventory_host_read" },
    ]);
    const output = generatePreview(declared);
    expect(output).toContain("+4 bool relations");
    expect(output).toContain("inventory_any_any");
    expect(output).toContain("inventory_host_any");
    expect(output).toContain("inventory_any_read");
    expect(output).toContain("inventory_host_read");
  });

  it("shows permission effects", () => {
    const declared = makeDeclared([
      { application: "inventory", resource: "host", verb: "read", v2Perm: "inventory_host_read" },
    ]);
    const output = generatePreview(declared);
    expect(output).toContain("permission: inventory_host_read");
  });

  it("shows public mark", () => {
    const declared = makeDeclared([
      { application: "inventory", resource: "host", verb: "read", v2Perm: "inventory_host_read" },
    ]);
    const output = generatePreview(declared);
    expect(output).toContain("mark public: inventory_host_read");
  });

  it("shows accumulate contributions", () => {
    const declared = makeDeclared([
      { application: "inventory", resource: "host", verb: "read", v2Perm: "inventory_host_read" },
    ]);
    const output = generatePreview(declared);
    expect(output).toContain("contributes inventory_host_read to view_metadata (when verb==read)");
  });

  it("does not show JSON Schema field additions (removed from V1 template)", () => {
    const declared = makeDeclared([
      { application: "inventory", resource: "host", verb: "read", v2Perm: "inventory_host_read" },
    ]);
    const output = generatePreview(declared);
    expect(output).not.toContain("inventory_host_read_id");
    expect(output).not.toContain("json_schema");
  });

  it("handles multiple extensions", () => {
    const declared = makeDeclared([
      { application: "inventory", resource: "host", verb: "read", v2Perm: "inventory_host_read" },
      { application: "notifications", resource: "integration", verb: "write", v2Perm: "notifications_integration_write" },
    ]);
    const output = generatePreview(declared);
    expect(output).toContain("inventory_host_read (inventory/host/read):");
    expect(output).toContain("notifications_integration_write (notifications/integration/write):");
  });
});
