import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { generateMetadata } from "../../src/lib.js";
import { parseZedDefinitions } from "../helpers/zed-parser.js";
import { compilePipeline, goldenDir, allDiscovered, type PipelineResult } from "../helpers/pipeline.js";

let pipeline: PipelineResult;

beforeAll(async () => {
  pipeline = await compilePipeline();
}, 30_000);

// --- Gate Tests ---

describe("G1: Authorization Completeness", () => {
  it("produces definition blocks for all four RBAC types", () => {
    expect(pipeline.spicedbOutput).toContain("definition rbac/principal {");
    expect(pipeline.spicedbOutput).toContain("definition rbac/role {");
    expect(pipeline.spicedbOutput).toContain("definition rbac/role_binding {");
    expect(pipeline.spicedbOutput).toContain("definition rbac/workspace {");
  });

  it("contains relation declarations with type references", () => {
    expect(pipeline.spicedbOutput).toMatch(/relation\s+t_\w+:\s+rbac\/\w+/);
  });

  it("contains permission declarations using union (+)", () => {
    expect(pipeline.spicedbOutput).toMatch(/permission\s+\w+\s*=\s*.*\+/);
  });

  it("contains permission declarations using intersection (&)", () => {
    expect(pipeline.spicedbOutput).toMatch(/permission\s+\w+\s*=\s*\(.*&/);
  });

  it("contains permission declarations using arrow (->)", () => {
    expect(pipeline.spicedbOutput).toMatch(/permission\s+\w+\s*=\s*.*->/);
  });
});

describe("G2: Data Field Support", () => {
  it("discovers at least one resource and extension", () => {
    expect(pipeline.resources.length).toBeGreaterThanOrEqual(1);
    expect(allDiscovered(pipeline).length).toBeGreaterThanOrEqual(1);
  });

  it("HBI host resource is discovered", () => {
    const host = pipeline.resources.find((r) => r.name === "host");
    expect(host).toBeDefined();
  });
});

describe("G4: Cooperative Extensions", () => {
  it("extensions add permissions to role, role_binding, and workspace", () => {
    const role = pipeline.fullSchema.find((r) => r.name === "role" && r.namespace === "rbac");
    const rb = pipeline.fullSchema.find((r) => r.name === "role_binding" && r.namespace === "rbac");
    const ws = pipeline.fullSchema.find((r) => r.name === "workspace" && r.namespace === "rbac");

    expect(role!.relations.some((r) => r.name === "inventory_host_view")).toBe(true);
    expect(rb!.relations.some((r) => r.name === "inventory_host_view")).toBe(true);
    expect(ws!.relations.some((r) => r.name === "inventory_host_view")).toBe(true);
  });

  it("extensions are invoked from HBI/Remediations, not inlined in RBAC", () => {
    const exts = allDiscovered(pipeline);
    expect(exts.some((e) => e.params.application === "inventory")).toBe(true);
    expect(exts.some((e) => e.params.application === "remediations")).toBe(true);
  });

  it("no duplicate permission names on role for same extension", () => {
    const role = pipeline.fullSchema.find((r) => r.name === "role" && r.namespace === "rbac")!;
    const names = role.relations.map((r) => r.name);
    const wildcardCounts = new Map<string, number>();
    for (const n of names) {
      wildcardCounts.set(n, (wildcardCounts.get(n) || 0) + 1);
    }
    for (const [name, count] of wildcardCounts) {
      if (name.includes("_any_") || name === "any_any_any") {
        expect(count, `duplicate wildcard: ${name}`).toBe(1);
      }
    }
  });
});

describe("G5: Cross-Namespace Composition", () => {
  it("HBI host references rbac/workspace in SpiceDB output", () => {
    expect(pipeline.spicedbOutput).toContain("relation t_workspace: rbac/workspace");
  });

  it("host permissions arrow into workspace permissions", () => {
    expect(pipeline.spicedbOutput).toContain("t_workspace->inventory_host_view");
    expect(pipeline.spicedbOutput).toContain("t_workspace->inventory_host_update");
  });
});

// --- M1: Feature Coverage ---

describe("M1: Feature Coverage", () => {
  it("RBAC core types: principal, role, role_binding, workspace", () => {
    const rbacNames = pipeline.fullSchema
      .filter((r) => r.namespace === "rbac")
      .map((r) => r.name)
      .sort();
    expect(rbacNames).toEqual(expect.arrayContaining(["principal", "role", "role_binding", "workspace"]));
  });

  it("HBI host with workspace relation and view/update permissions", () => {
    const host = pipeline.fullSchema.find((r) => r.name === "host");
    expect(host).toBeDefined();
    expect(host!.relations.some((r) => r.name === "workspace")).toBe(true);
    expect(host!.relations.some((r) => r.name === "view")).toBe(true);
    expect(host!.relations.some((r) => r.name === "update")).toBe(true);
  });

  it("remediations is permissions-only — no definition in SpiceDB output", () => {
    expect(pipeline.spicedbOutput).not.toMatch(/definition\s+remediations\//);
  });

  it("namespace separation — RBAC and HBI in separate definitions", () => {
    const defs = parseZedDefinitions(pipeline.spicedbOutput);
    const namespaces = new Set([...defs.keys()].map((k) => k.split("/")[0]));
    expect(namespaces.has("rbac")).toBe(true);
    expect(namespaces.has("inventory")).toBe(true);
  });

  it("V1WorkspacePermission extension mechanism discovers extensions from aliases", () => {
    const exts = allDiscovered(pipeline);
    expect(exts.length).toBeGreaterThanOrEqual(4);
    expect(exts.some((e) => e.params.v2Perm === "inventory_host_view")).toBe(true);
    expect(exts.some((e) => e.params.v2Perm === "inventory_host_update")).toBe(true);
    expect(exts.some((e) => e.params.v2Perm === "remediations_remediation_view")).toBe(true);
    expect(exts.some((e) => e.params.v2Perm === "remediations_remediation_update")).toBe(true);
  });

  it("any_any_any wildcard naming", () => {
    expect(pipeline.spicedbOutput).toContain("any_any_any");
    expect(pipeline.spicedbOutput).not.toContain("all_all_all");
  });

  it("binding workspace relation (not user_grant)", () => {
    expect(pipeline.spicedbOutput).toContain("t_binding");
    expect(pipeline.spicedbOutput).not.toContain("t_user_grant");
  });

  it("t_ prefix on all assignable relations", () => {
    const defs = parseZedDefinitions(pipeline.spicedbOutput);
    for (const [, block] of defs) {
      for (const rel of block.relations) {
        const match = rel.match(/relation\s+(t_\w+)/);
        expect(match, `relation without t_ prefix: ${rel}`).toBeTruthy();
      }
    }
  });

  it("view_metadata accumulation on workspace", () => {
    const ws = pipeline.fullSchema.find((r) => r.name === "workspace" && r.namespace === "rbac")!;
    const viewMeta = ws.relations.find((r) => r.name === "view_metadata");
    expect(viewMeta).toBeDefined();
    expect(pipeline.spicedbOutput).toMatch(/permission view_metadata\s*=/);
  });

  it("cross-namespace composition — HBI imports RBAC workspace", () => {
    expect(pipeline.spicedbOutput).toContain("relation t_workspace: rbac/workspace");
  });

  it("metadata output lists permissions and resources per service", () => {
    const metadata = generateMetadata(pipeline.resources, pipeline.providerResults, pipeline.providerMap);
    expect(metadata.inventory).toBeDefined();
    expect(metadata.inventory.permissions).toContain("inventory_host_view");
    expect(metadata.remediations).toBeDefined();
    expect(metadata.remediations.resources).toEqual([]);
  });
});

// --- M4: Output Correctness (SpiceDB) ---

describe("M4: SpiceDB Output Correctness vs Golden Reference", () => {
  let goldenDefs: Map<string, import("../helpers/zed-parser.js").DefinitionBlock>;
  let emitterDefs: Map<string, import("../helpers/zed-parser.js").DefinitionBlock>;

  beforeAll(() => {
    const goldenPath = path.join(goldenDir, "spicedb-reference.zed");
    const goldenText = fs.readFileSync(goldenPath, "utf-8");
    goldenDefs = parseZedDefinitions(goldenText);
    emitterDefs = parseZedDefinitions(pipeline.spicedbOutput);
  });

  it("emitter produces the same number of definitions as the golden reference", () => {
    expect(emitterDefs.size).toBe(goldenDefs.size);
  });

  it("every golden definition exists in emitter output", () => {
    for (const [goldenName] of goldenDefs) {
      expect(emitterDefs.has(goldenName), `missing definition: ${goldenName}`).toBe(true);
    }
  });

  it("rbac/principal is empty in both", () => {
    const goldenPrincipal = goldenDefs.get("rbac/principal")!;
    const emitterPrincipal = emitterDefs.get("rbac/principal")!;
    expect(goldenPrincipal.permissions).toHaveLength(0);
    expect(goldenPrincipal.relations).toHaveLength(0);
    expect(emitterPrincipal.permissions).toHaveLength(0);
    expect(emitterPrincipal.relations).toHaveLength(0);
  });

  it("rbac/role has the same permission count", () => {
    const golden = goldenDefs.get("rbac/role")!;
    const emitter = emitterDefs.get("rbac/role")!;
    expect(emitter.permissions.length).toBe(golden.permissions.length);
  });

  it("rbac/role has the same relation count", () => {
    const golden = goldenDefs.get("rbac/role")!;
    const emitter = emitterDefs.get("rbac/role")!;
    expect(emitter.relations.length).toBe(golden.relations.length);
  });

  it("rbac/role_binding has the same permission set", () => {
    const golden = goldenDefs.get("rbac/role_binding")!;
    const emitter = emitterDefs.get("rbac/role_binding")!;

    const goldenPerms = golden.permissions.map((p) => p.trim()).sort();
    const emitterPerms = emitter.permissions.map((p) => p.trim()).sort();
    expect(emitterPerms).toEqual(goldenPerms);
  });

  it("rbac/workspace has view_metadata permission", () => {
    const emitter = emitterDefs.get("rbac/workspace")!;
    const hasViewMeta = emitter.permissions.some((p) => p.includes("view_metadata"));
    expect(hasViewMeta).toBe(true);
  });

  it("rbac/workspace view_metadata ORs the two read-verb permissions", () => {
    const emitter = emitterDefs.get("rbac/workspace")!;
    const viewMetaLine = emitter.permissions.find((p) => p.includes("view_metadata"))!;
    expect(viewMetaLine).toContain("inventory_host_view");
    expect(viewMetaLine).toContain("remediations_remediation_view");
  });

  it("rbac/workspace has the same permission count as golden reference", () => {
    const golden = goldenDefs.get("rbac/workspace")!;
    const emitter = emitterDefs.get("rbac/workspace")!;
    expect(emitter.permissions.length).toBe(golden.permissions.length);
  });

  it("rbac/workspace has the same relation count as golden reference", () => {
    const golden = goldenDefs.get("rbac/workspace")!;
    const emitter = emitterDefs.get("rbac/workspace")!;
    expect(emitter.relations.length).toBe(golden.relations.length);
  });

  it("host definition matches structurally", () => {
    const emitterHost = emitterDefs.get("inventory/host");
    const goldenHost = goldenDefs.get("inventory/host");

    expect(emitterHost).toBeDefined();
    expect(goldenHost).toBeDefined();

    expect(emitterHost!.permissions.length).toBe(goldenHost!.permissions.length);
    expect(emitterHost!.relations.length).toBe(goldenHost!.relations.length);

    const emitterPermsSorted = emitterHost!.permissions.map((p) => p.trim()).sort();
    const goldenPermsSorted = goldenHost!.permissions.map((p) => p.trim()).sort();
    expect(emitterPermsSorted).toEqual(goldenPermsSorted);
  });

  it("no remediations/* definition in either output", () => {
    for (const [name] of goldenDefs) {
      expect(name).not.toMatch(/^remediations\//);
    }
    for (const [name] of emitterDefs) {
      expect(name).not.toMatch(/^remediations\//);
    }
  });
});

// --- M4: Output Correctness (Metadata) ---

describe("M4: Metadata Output Correctness", () => {
  it("matches expected benchmark metadata", () => {
    const metadata = generateMetadata(pipeline.resources, pipeline.providerResults, pipeline.providerMap);

    expect(metadata.inventory).toBeDefined();
    expect(metadata.inventory.permissions).toEqual(
      expect.arrayContaining(["inventory_host_view", "inventory_host_update"])
    );
    expect(metadata.inventory.resources).toContain("host");

    expect(metadata.remediations).toBeDefined();
    expect(metadata.remediations.permissions).toEqual(
      expect.arrayContaining(["remediations_remediation_view", "remediations_remediation_update"])
    );
    expect(metadata.remediations.resources).toEqual([]);
  });
});

// --- Structural detail tests ---

describe("SpiceDB structural conventions", () => {
  it("every relation uses t_ prefix", () => {
    const lines = pipeline.spicedbOutput.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("relation ")) {
        expect(trimmed).toMatch(/^relation t_/);
      }
    }
  });

  it("every assignable relation has a matching permission wrapper", () => {
    const defs = parseZedDefinitions(pipeline.spicedbOutput);
    for (const [, block] of defs) {
      for (const rel of block.relations) {
        const relName = rel.match(/relation (t_\w+)/)?.[1];
        if (!relName) continue;
        const permName = relName.replace(/^t_/, "");
        const hasPerm = block.permissions.some((p) => p.includes(`permission ${permName}`));
        expect(hasPerm, `relation ${relName} has no matching permission ${permName}`).toBe(true);
      }
    }
  });
});
