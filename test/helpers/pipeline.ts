import * as path from "path";
import { fileURLToPath } from "url";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import type { ResourceDef, UnifiedJsonSchema, CascadeDeleteEntry, AnnotationEntry } from "../../src/types.js";
import type { ValidationDiagnostic } from "../../src/safety.js";
import type { MetadataContribution } from "../../src/generate.js";
import { discoverResources } from "../../src/discover-resources.js";
import { discoverDecoratedCascadePolicies, discoverDecoratedAnnotations } from "../../src/discover-decorated.js";
import { generateSpiceDB, generateUnifiedJsonSchemas } from "../../src/generate.js";
import { expandCascadeDeletePolicies } from "../../src/expand-cascade.js";
import {
  validatePreExpansionExpressions,
  validatePermissionExpressions,
} from "../../src/safety.js";
import {
  discoverV1Permissions,
  expandV1Permissions,
  wireDeleteScaffold,
  wirePermissionRelations,
  buildPermissionsByApp,
  type V1Extension,
} from "../../src/expand-v1.js";
import { ResourceGraph } from "../../src/resource-graph.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pocRoot = path.resolve(__dirname, "../..");
export const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
export const goldenDir = path.resolve(pocRoot, "test/fixtures");
const distEntry = path.resolve(pocRoot, "dist/index.js");

export interface PipelineResult {
  resources: ResourceDef[];
  permissions: V1Extension[];
  metadataContributions: MetadataContribution[];
  annotations: Map<string, AnnotationEntry[]>;
  cascadePolicies: CascadeDeleteEntry[];
  fullSchema: ResourceDef[];
  spicedbOutput: string;
  unifiedJsonSchemas: Record<string, UnifiedJsonSchema>;
  preExpansionDiagnostics: ValidationDiagnostic[];
  diagnostics: ValidationDiagnostic[];
  warnings: string[];
  ownedNamespaces: Set<string>;
}

export async function compilePipeline(): Promise<PipelineResult> {
  const program: Program = await compile(NodeHost, mainTsp, {
    noEmit: true,
    additionalImports: [distEntry],
  });
  const warnings: string[] = [];

  const { resources } = discoverResources(program);
  const permissions = discoverV1Permissions(program);

  const annotations = discoverDecoratedAnnotations(program);
  const cascadePolicies = discoverDecoratedCascadePolicies(program);

  wirePermissionRelations(resources, permissions);

  const preExpansionDiagnostics = validatePreExpansionExpressions(resources);
  for (const d of preExpansionDiagnostics) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  const expandGraph = new ResourceGraph(resources);
  expandV1Permissions(expandGraph, permissions);
  const afterRbac = expandGraph.toResources();
  warnings.push(...expandGraph.warnings);

  const scaffoldGraph = new ResourceGraph(afterRbac);
  wireDeleteScaffold(scaffoldGraph);
  const scaffolded = scaffoldGraph.toResources();

  const cascadeResult = expandCascadeDeletePolicies(scaffolded, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  const diagnostics = validatePermissionExpressions(fullSchema);
  const ownedNamespaces = new Set(["rbac"]);
  const spicedbOutput = generateSpiceDB(fullSchema);
  const unifiedJsonSchemas = generateUnifiedJsonSchemas(fullSchema, ownedNamespaces);

  const permissionsByApp = buildPermissionsByApp(permissions);
  const metadataContributions: MetadataContribution[] = [{ permissionsByApp }];

  return {
    resources,
    permissions,
    metadataContributions,
    annotations,
    cascadePolicies,
    fullSchema,
    spicedbOutput,
    unifiedJsonSchemas,
    preExpansionDiagnostics,
    diagnostics,
    warnings,
    ownedNamespaces,
  };
}
