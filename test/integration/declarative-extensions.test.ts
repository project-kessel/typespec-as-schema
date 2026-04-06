import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile, NodeHost } from "@typespec/compiler";
import {
  discoverResources,
  buildSchemaFromTypeGraph,
  generateSpiceDB,
  generateUnifiedJsonSchemas,
  type ResourceDef,
  type V1Extension,
  type UnifiedJsonSchema,
} from "../../emitter/lib.js";
import {
  discoverDeclaredExtensions,
  applyDeclaredPatches,
  type DeclaredExtension,
  type JsonSchemaFieldRule,
} from "../../emitter/declarative-extensions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pocRoot = path.resolve(__dirname, "../..");

// Compile the original (hardcoded) approach
const mainOriginal = path.resolve(pocRoot, "main.tsp");
// Compile the declarative approach
const mainDeclarative = path.resolve(pocRoot, "main-declarative.tsp");

let hardcodedSpiceDB: string;
let declarativeSpiceDB: string;
let hardcodedFull: ResourceDef[];
let declarativeFull: ResourceDef[];
let declaredExtensions: DeclaredExtension[];
let jsonSchemaFields: JsonSchemaFieldRule[];
let declarativeJsonSchemas: Record<string, UnifiedJsonSchema>;

beforeAll(async () => {
  // 1. Hardcoded approach: compile main.tsp, apply buildSchemaFromTypeGraph
  const origProgram = await compile(NodeHost, mainOriginal, { noEmit: true });
  const origDiscovered = discoverResources(origProgram);
  hardcodedFull = buildSchemaFromTypeGraph(origDiscovered.resources, origDiscovered.extensions);
  hardcodedSpiceDB = generateSpiceDB(hardcodedFull);

  // 2. Declarative approach: compile main-declarative.tsp, discover patches, apply generically
  const declProgram = await compile(NodeHost, mainDeclarative, { noEmit: true });
  const declDiscovered = discoverResources(declProgram);
  declaredExtensions = discoverDeclaredExtensions(declProgram);
  const patchResult = applyDeclaredPatches(declDiscovered.resources, declaredExtensions);
  declarativeFull = patchResult.resources;
  jsonSchemaFields = patchResult.jsonSchemaFields;
  declarativeSpiceDB = generateSpiceDB(declarativeFull);
  declarativeJsonSchemas = generateUnifiedJsonSchemas(declarativeFull, jsonSchemaFields);
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

// ─── Discovery Tests ─────────────────────────────────────────────────

describe("Declarative extension discovery", () => {
  it("discovers 4 V1WorkspacePermission instances from main-declarative.tsp", () => {
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

  it("patch rules cover role, roleBinding, workspace, and jsonSchema targets", () => {
    for (const ext of declaredExtensions) {
      const targets = new Set(ext.patchRules.map((r) => r.target));
      expect(targets.has("role")).toBe(true);
      expect(targets.has("roleBinding")).toBe(true);
      expect(targets.has("workspace")).toBe(true);
      expect(targets.has("jsonSchema")).toBe(true);
    }
  });

  it("workspace accumulate rule replaces hardcoded viewMetadataAccumulator", () => {
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

// ─── Equivalence Tests ───────────────────────────────────────────────

describe("Declarative vs hardcoded: SpiceDB output equivalence", () => {
  it("produces same number of definitions", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);
    expect(declDefs.size).toBe(hardDefs.size);
  });

  it("produces same definition names (after namespace normalization)", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    const NAMESPACE_MAP: Record<string, string> = {
      "inventorydecl/host": "inventory/host",
    };

    const hardNames = [...hardDefs.keys()].sort();
    const declNames = [...declDefs.keys()].map((n) => NAMESPACE_MAP[n] ?? n).sort();
    expect(declNames).toEqual(hardNames);
  });

  it("rbac/principal is empty in both", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    expect(hardDefs.get("rbac/principal")!.permissions).toHaveLength(0);
    expect(declDefs.get("rbac/principal")!.permissions).toHaveLength(0);
  });

  it("rbac/role has identical permission count", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    expect(declDefs.get("rbac/role")!.permissions.length)
      .toBe(hardDefs.get("rbac/role")!.permissions.length);
  });

  it("rbac/role has identical relation count", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    expect(declDefs.get("rbac/role")!.relations.length)
      .toBe(hardDefs.get("rbac/role")!.relations.length);
  });

  it("rbac/role_binding has identical permissions (sorted)", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    const hardPerms = hardDefs.get("rbac/role_binding")!.permissions.map((p) => p.trim()).sort();
    const declPerms = declDefs.get("rbac/role_binding")!.permissions.map((p) => p.trim()).sort();
    expect(declPerms).toEqual(hardPerms);
  });

  it("rbac/workspace has identical permission count", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    expect(declDefs.get("rbac/workspace")!.permissions.length)
      .toBe(hardDefs.get("rbac/workspace")!.permissions.length);
  });

  it("rbac/workspace has identical relation count", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    expect(declDefs.get("rbac/workspace")!.relations.length)
      .toBe(hardDefs.get("rbac/workspace")!.relations.length);
  });

  it("rbac/workspace view_metadata ORs the same read-verb permissions", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    const hardVm = hardDefs.get("rbac/workspace")!.permissions.find((p) => p.includes("view_metadata"))!;
    const declVm = declDefs.get("rbac/workspace")!.permissions.find((p) => p.includes("view_metadata"))!;

    expect(declVm).toContain("inventory_host_view");
    expect(declVm).toContain("remediations_remediation_view");
    expect(hardVm).toContain("inventory_host_view");
    expect(hardVm).toContain("remediations_remediation_view");
  });

  it("rbac/workspace permission lines match (sorted, ignoring namespace prefix differences)", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    const hardPerms = hardDefs.get("rbac/workspace")!.permissions.map((p) => p.trim()).sort();
    const declPerms = declDefs.get("rbac/workspace")!.permissions.map((p) => p.trim()).sort();
    expect(declPerms).toEqual(hardPerms);
  });

  it("rbac/role permission lines match (sorted)", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    const hardPerms = hardDefs.get("rbac/role")!.permissions.map((p) => p.trim()).sort();
    const declPerms = declDefs.get("rbac/role")!.permissions.map((p) => p.trim()).sort();
    expect(declPerms).toEqual(hardPerms);
  });

  it("rbac/role relation lines match (sorted)", () => {
    const hardDefs = parseZedDefinitions(hardcodedSpiceDB);
    const declDefs = parseZedDefinitions(declarativeSpiceDB);

    const hardRels = hardDefs.get("rbac/role")!.relations.map((r) => r.trim()).sort();
    const declRels = declDefs.get("rbac/role")!.relations.map((r) => r.trim()).sort();
    expect(declRels).toEqual(hardRels);
  });
});

// ─── Semantic model tests ────────────────────────────────────────────

describe("Declarative extension: enriched model semantics", () => {
  it("role gets bool relations for each extension's hierarchy levels", () => {
    const role = declarativeFull.find((r) => r.name === "role" && r.namespace === "rbac")!;
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
    const ws = declarativeFull.find((r) => r.name === "workspace" && r.namespace === "rbac")!;
    const invView = ws.relations.find((r) => r.name === "inventory_host_view");
    expect(invView?.isPublic).toBe(true);

    const viewMeta = ws.relations.find((r) => r.name === "view_metadata");
    expect(viewMeta?.isPublic).toBe(true);
  });

  it("view_metadata only accumulates read-verb extensions (via generic accumulate)", () => {
    const ws = declarativeFull.find((r) => r.name === "workspace" && r.namespace === "rbac")!;
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
    const hostSchema = declarativeJsonSchemas["inventorydecl/host"];
    expect(hostSchema).toBeDefined();
    expect(hostSchema.properties["inventory_host_view_id"]).toBeDefined();
    expect(hostSchema.properties["inventory_host_view_id"].type).toBe("string");
    expect(hostSchema.properties["inventory_host_view_id"].format).toBe("uuid");
    expect(hostSchema.properties["inventory_host_view_id"].source).toBe("extension-declared");
  });

  it("extension-declared required fields appear in the required array", () => {
    const hostSchema = declarativeJsonSchemas["inventorydecl/host"];
    expect(hostSchema.required).toContain("inventory_host_view_id");
    expect(hostSchema.required).toContain("inventory_host_update_id");
  });

  it("relation-derived fields (workspace_id) still present alongside extension fields", () => {
    const hostSchema = declarativeJsonSchemas["inventorydecl/host"];
    expect(hostSchema.properties["workspace_id"]).toBeDefined();
    expect(hostSchema.required).toContain("workspace_id");
  });
});
