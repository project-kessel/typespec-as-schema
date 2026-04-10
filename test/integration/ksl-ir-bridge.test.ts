import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { compileAndDiscover } from "../../src/lib.js";
import { generateKslIR } from "../../src/ksl-ir-emitter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pocRoot = path.resolve(__dirname, "../..");
const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
const kslSamplesDir = path.resolve(pocRoot, "../ksl-schema-language/samples");

interface KslNamespace {
  name: string;
  imports?: string[];
  types?: Array<{
    name: string;
    visibility?: string;
    relations: Array<{
      name: string;
      body: Record<string, unknown>;
      extensions?: Array<{ namespace?: string; name: string; params?: Record<string, string> }>;
    }>;
  }>;
  extension_references?: Array<{
    namespace?: string;
    name: string;
    params?: Record<string, string>;
  }>;
}

let kslNamespaces: KslNamespace[];

beforeAll(async () => {
  const { resources, extensions } = await compileAndDiscover(mainTsp);
  kslNamespaces = generateKslIR(resources, extensions);
}, 30_000);

describe("KSL IR Bridge: TypeSpec -> KSL Intermediate JSON", () => {
  it("produces exactly 2 namespaces (inventory + remediations)", () => {
    expect(kslNamespaces).toHaveLength(2);
    const names = kslNamespaces.map((ns) => ns.name).sort();
    expect(names).toEqual(["inventory", "remediations"]);
  });

  it("inventory namespace matches structure of KSL-compiled samples/inventory.ksl", () => {
    const inv = kslNamespaces.find((ns) => ns.name === "inventory")!;
    expect(inv.imports).toContain("rbac");
    expect(inv.types).toHaveLength(1);

    const host = inv.types![0];
    expect(host.name).toBe("host");
    expect(host.relations).toHaveLength(3);

    const relNames = host.relations.map((r) => r.name).sort();
    expect(relNames).toEqual(["update", "view", "workspace"]);
  });

  it("host workspace relation is self/ExactlyOne to rbac/workspace", () => {
    const inv = kslNamespaces.find((ns) => ns.name === "inventory")!;
    const workspace = inv.types![0].relations.find((r) => r.name === "workspace")!;

    expect(workspace.body.kind).toBe("self");
    expect(workspace.body.cardinality).toBe("ExactlyOne");
    expect(workspace.body.types).toEqual([{ namespace: "rbac", name: "workspace" }]);
  });

  it("host view/update are nested_reference to workspace permissions", () => {
    const inv = kslNamespaces.find((ns) => ns.name === "inventory")!;
    const view = inv.types![0].relations.find((r) => r.name === "view")!;
    expect(view.body.kind).toBe("nested_reference");
    expect(view.body.relation).toBe("workspace");
    expect(view.body.sub_relation).toBe("inventory_host_view");

    const update = inv.types![0].relations.find((r) => r.name === "update")!;
    expect(update.body.kind).toBe("nested_reference");
    expect(update.body.sub_relation).toBe("inventory_host_update");
  });

  it("inventory has workspace_permission extension refs with correct params", () => {
    const inv = kslNamespaces.find((ns) => ns.name === "inventory")!;
    const wpRefs = inv.extension_references!.filter((r) => r.name === "workspace_permission");
    expect(wpRefs).toHaveLength(2);

    const viewRef = wpRefs.find((r) => r.params!.full_name === "inventory_host_view")!;
    expect(viewRef.params!.v1_resource).toBe("hosts");
    expect(viewRef.params!.v1_verb).toBe("read");

    const updateRef = wpRefs.find((r) => r.params!.full_name === "inventory_host_update")!;
    expect(updateRef.params!.v1_resource).toBe("hosts");
    expect(updateRef.params!.v1_verb).toBe("write");
  });

  it("inventory has add_view_metadata ref only for the read-verb extension", () => {
    const inv = kslNamespaces.find((ns) => ns.name === "inventory")!;
    const vmRefs = inv.extension_references!.filter((r) => r.name === "add_view_metadata");
    expect(vmRefs).toHaveLength(1);
    expect(vmRefs[0].params!.full_name).toBe("inventory_host_view");
  });

  it("remediations is permissions-only (no types)", () => {
    const rem = kslNamespaces.find((ns) => ns.name === "remediations")!;
    expect(rem.types).toBeUndefined();
    expect(rem.imports).toContain("rbac");
  });

  it("remediations has correct workspace_permission extension refs", () => {
    const rem = kslNamespaces.find((ns) => ns.name === "remediations")!;
    const wpRefs = rem.extension_references!.filter((r) => r.name === "workspace_permission");
    expect(wpRefs).toHaveLength(2);

    expect(wpRefs.some((r) => r.params!.full_name === "remediations_remediation_view")).toBe(true);
    expect(wpRefs.some((r) => r.params!.full_name === "remediations_remediation_update")).toBe(true);
  });

  it("all relation body kinds use KSL naming (self, reference, nested_reference, union, intersect)", () => {
    const validKinds = new Set(["self", "reference", "nested_reference", "union", "intersect", "except"]);
    for (const ns of kslNamespaces) {
      for (const t of ns.types || []) {
        for (const rel of t.relations) {
          function checkKinds(body: Record<string, unknown>) {
            expect(validKinds.has(body.kind as string), `invalid kind: ${body.kind}`).toBe(true);
            if (body.left) checkKinds(body.left as Record<string, unknown>);
            if (body.right) checkKinds(body.right as Record<string, unknown>);
          }
          checkKinds(rel.body);
        }
      }
    }
  });
});
