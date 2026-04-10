import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  compileAndDiscover,
  buildSchemaFromTypeGraph,
  generateSpiceDB,
  generateUnifiedJsonSchemas,
  type ResourceDef,
  type UnifiedJsonSchema,
  type V1Extension,
} from "../../src/lib.js";
import {
  discoverDeclaredExtensions,
  type DeclaredExtension,
  type JsonSchemaFieldRule,
} from "../../src/declarative-extensions.js";
import { expandSchemaWithExtensions } from "../../src/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pocRoot = path.resolve(__dirname, "../..");
const mainTsp = path.resolve(pocRoot, "schema/main.tsp");

let fullSchema: ResourceDef[];
let spicedbOutput: string;
let declaredExtensions: DeclaredExtension[];
let jsonSchemaFields: JsonSchemaFieldRule[];
let unifiedJsonSchemas: Record<string, UnifiedJsonSchema>;
let resources: ResourceDef[];
let extensions: V1Extension[];

beforeAll(async () => {
  const discovered = await compileAndDiscover(mainTsp);
  resources = discovered.resources;
  extensions = discovered.extensions;
  declaredExtensions = discoverDeclaredExtensions(discovered.program);
  const expanded = expandSchemaWithExtensions(discovered.program, resources);
  fullSchema = expanded.fullSchema;
  jsonSchemaFields = expanded.jsonSchemaFields;
  spicedbOutput = generateSpiceDB(fullSchema);
  unifiedJsonSchemas = generateUnifiedJsonSchemas(fullSchema, jsonSchemaFields);
}, 30_000);

// ─── Helpers ─────────────────────────────────────────────────────────

interface DefinitionBlock {
  name: string;
  permissions: string[];
  relations: string[];
}

function parseZedDefinitions(zedText: string): Map<string, DefinitionBlock> {
  const blocks = new Map<string, DefinitionBlock>();
  const lines = zedText.split("\n");
  let current: DefinitionBlock | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("//") || line === "") continue;

    const defMatch = line.match(/^definition\s+(\S+)\s*\{/);
    if (defMatch) {
      current = { name: defMatch[1], permissions: [], relations: [] };
      blocks.set(defMatch[1], current);
      continue;
    }

    if (line === "}" || line === "{}") {
      current = null;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("permission ")) {
      current.permissions.push(line);
    } else if (line.startsWith("relation ")) {
      current.relations.push(line);
    }
  }

  return blocks;
}

// ─── Regression: legacy expander ─────────────────────────────────────

describe("expandSchemaWithExtensions vs buildSchemaFromTypeGraph", () => {
  it("produces the same ResourceDef graph as the legacy hardcoded expander", () => {
    const legacy = buildSchemaFromTypeGraph(resources, extensions);
    expect(fullSchema).toEqual(legacy);
  });

  it("produces identical SpiceDB text to the legacy expander", () => {
    const legacy = buildSchemaFromTypeGraph(resources, extensions);
    expect(generateSpiceDB(fullSchema)).toBe(generateSpiceDB(legacy));
  });
});

// ─── Discovery Tests ─────────────────────────────────────────────────

describe("Declarative extension discovery", () => {
  it("discovers 4 V1WorkspacePermission instances from schema/main.tsp", () => {
    expect(declaredExtensions).toHaveLength(4);
  });

  it("extracts correct parameters from each instance", () => {
    const perms = declaredExtensions.map((e) => e.params.v2Perm).sort();
    expect(perms).toEqual([
      "inventory_host_update",
      "inventory_host_view",
      "remediations_remediation_update",
      "remediations_remediation_view",
    ]);
  });

  it("each instance has 7 patch rules (role, roleBinding, workspace, jsonSchema)", () => {
    for (const ext of declaredExtensions) {
      expect(ext.patchRules.length).toBe(7);
    }
  });

  it("attaches application (and resource) to collected JSON Schema field rules", () => {
    const inv = jsonSchemaFields.filter((f) => f.application === "inventory");
    const rem = jsonSchemaFields.filter((f) => f.application === "remediations");
    expect(inv).toHaveLength(2);
    expect(rem).toHaveLength(2);
    expect(inv.every((f) => f.resource === "hosts")).toBe(true);
    expect(rem.every((f) => f.resource === "remediations")).toBe(true);
  });

  it("patch rules cover role, roleBinding, workspace, and jsonSchema targets", () => {
    for (const ext of declaredExtensions) {
      const targets = new Set(ext.patchRules.map((r) => r.target));
      expect(targets.has("role")).toBe(true);
      expect(targets.has("roleBinding")).toBe(true);
      expect(targets.has("workspace")).toBe(true);
      expect(targets.has("jsonSchema")).toBe(true);
    }
  });

  it("workspace accumulate rule encodes view_metadata", () => {
    for (const ext of declaredExtensions) {
      const accRule = ext.patchRules.find(
        (r) => r.target === "workspace" && r.patchType === "accumulate",
      );
      expect(accRule).toBeDefined();
      expect(accRule!.rawValue).toContain("view_metadata=or({v2})");
      expect(accRule!.rawValue).toContain("when={verb}==read");
    }
  });
});

// ─── SpiceDB smoke ───────────────────────────────────────────────────

describe("Declarative pipeline: SpiceDB output", () => {
  it("rbac/workspace view_metadata ORs read-verb permissions", () => {
    const defs = parseZedDefinitions(spicedbOutput);
    const vm = defs.get("rbac/workspace")!.permissions.find((p) => p.includes("view_metadata"))!;
    expect(vm).toContain("inventory_host_view");
    expect(vm).toContain("remediations_remediation_view");
  });
});

// ─── Semantic model tests ────────────────────────────────────────────

describe("Declarative extension: enriched model semantics", () => {
  it("role gets bool relations for each extension's hierarchy levels", () => {
    const role = fullSchema.find((r) => r.name === "role" && r.namespace === "rbac")!;
    const boolNames = role.relations
      .filter((r) => r.body.kind === "bool")
      .map((r) => r.name);

    expect(boolNames).toContain("inventory_any_any");
    expect(boolNames).toContain("inventory_hosts_any");
    expect(boolNames).toContain("inventory_any_read");
    expect(boolNames).toContain("inventory_hosts_read");
    expect(boolNames).toContain("inventory_any_write");
    expect(boolNames).toContain("inventory_hosts_write");
  });

  it("workspace permissions are marked public", () => {
    const ws = fullSchema.find((r) => r.name === "workspace" && r.namespace === "rbac")!;
    const invView = ws.relations.find((r) => r.name === "inventory_host_view");
    expect(invView?.isPublic).toBe(true);

    const viewMeta = ws.relations.find((r) => r.name === "view_metadata");
    expect(viewMeta?.isPublic).toBe(true);
  });

  it("view_metadata only accumulates read-verb extensions (via generic accumulate)", () => {
    const ws = fullSchema.find((r) => r.name === "workspace" && r.namespace === "rbac")!;
    const viewMeta = ws.relations.find((r) => r.name === "view_metadata")!;

    expect(viewMeta.body.kind).toBe("or");
    if (viewMeta.body.kind === "or") {
      const memberNames = viewMeta.body.members
        .filter((m): m is { kind: "ref"; name: string } => m.kind === "ref")
        .map((m) => m.name)
        .sort();
      expect(memberNames).toEqual([
        "inventory_host_view",
        "remediations_remediation_view",
      ]);
    }
  });
});

// ─── JSON Schema patch tests ─────────────────────────────────────────

describe("Declarative extension: JSON Schema field patches", () => {
  it("collects JSON Schema fields from extension instances", () => {
    expect(jsonSchemaFields.length).toBeGreaterThan(0);
  });

  it("produces one field per extension instance (4 extensions = 4 fields)", () => {
    expect(jsonSchemaFields).toHaveLength(4);
  });

  it("field names are interpolated from v2Perm", () => {
    const names = jsonSchemaFields.map((f) => f.fieldName).sort();
    expect(names).toEqual([
      "inventory_host_update_id",
      "inventory_host_view_id",
      "remediations_remediation_update_id",
      "remediations_remediation_view_id",
    ]);
  });

  it("fields have correct type and format", () => {
    for (const field of jsonSchemaFields) {
      expect(field.fieldType).toBe("string");
      expect(field.format).toBe("uuid");
      expect(field.required).toBe(true);
    }
  });

  it("JSON Schema output includes extension-declared fields on service resources", () => {
    const hostSchema = unifiedJsonSchemas["inventory/host"];
    expect(hostSchema).toBeDefined();
    expect(hostSchema.properties["inventory_host_view_id"]).toBeDefined();
    expect(hostSchema.properties["inventory_host_view_id"].type).toBe("string");
    expect(hostSchema.properties["inventory_host_view_id"].format).toBe("uuid");
    expect(hostSchema.properties["inventory_host_view_id"].source).toBe("extension-declared");
  });

  it("does not apply other services' jsonSchema_addField rules to inventory/host", () => {
    const hostSchema = unifiedJsonSchemas["inventory/host"];
    expect(hostSchema.properties["remediations_remediation_view_id"]).toBeUndefined();
    expect(hostSchema.properties["remediations_remediation_update_id"]).toBeUndefined();
  });

  it("extension-declared required fields appear in the required array", () => {
    const hostSchema = unifiedJsonSchemas["inventory/host"];
    expect(hostSchema.required).toContain("inventory_host_view_id");
    expect(hostSchema.required).toContain("inventory_host_update_id");
  });

  it("relation-derived fields (workspace_id) still present alongside extension fields", () => {
    const hostSchema = unifiedJsonSchemas["inventory/host"];
    expect(hostSchema.properties["workspace_id"]).toBeDefined();
    expect(hostSchema.required).toContain("workspace_id");
  });
});
