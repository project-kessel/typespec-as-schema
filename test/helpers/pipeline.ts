import * as path from "path";
import { fileURLToPath } from "url";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import type { ResourceDef, UnifiedJsonSchema, CascadeDeleteEntry, AnnotationEntry } from "../../src/types.js";
import type { ValidationDiagnostic } from "../../src/safety.js";
import type { MetadataContribution } from "../../src/generate.js";
import { discoverResources } from "../../src/discover-resources.js";
import { discoverDecoratedCascadePolicies, discoverDecoratedAnnotations } from "../../src/discover-decorated.js";
import { discoverTemplateInstances } from "../../src/discover-templates.js";
import { generateSpiceDB, generateUnifiedJsonSchemas } from "../../src/generate.js";
import { expandCascadeDeletePolicies } from "../../src/expand-cascade.js";
import {
  validatePreExpansionExpressions,
  validatePermissionExpressions,
} from "../../src/safety.js";
import { ResourceGraph } from "../../src/resource-graph.js";
import { loadExtensionModules } from "../../src/extension-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pocRoot = path.resolve(__dirname, "../..");
export const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
export const goldenDir = path.resolve(pocRoot, "test/fixtures");
const distEntry = path.resolve(pocRoot, "dist/index.js");
const schemaDir = path.resolve(pocRoot, "schema");

export interface PipelineResult {
  resources: ResourceDef[];
  extensions: { templateName: string; instances: Record<string, string>[] }[];
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

  const extensionModules = await loadExtensionModules(schemaDir);

  const graph = new ResourceGraph(resources);
  const extensionResults: { templateName: string; instances: Record<string, string>[] }[] = [];

  for (const ext of extensionModules) {
    const { results } = discoverTemplateInstances(program, ext.template);
    extensionResults.push({ templateName: ext.template.templateName, instances: results });
    ext.expand(graph, results);
  }
  warnings.push(...graph.warnings);

  const afterExpansion = graph.toResources();
  const preExpansionDiagnostics = validatePreExpansionExpressions(afterExpansion);
  for (const d of preExpansionDiagnostics) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  const scaffoldGraph = new ResourceGraph(afterExpansion);
  for (const ext of extensionModules) {
    if (ext.beforeCascadeDelete) {
      ext.beforeCascadeDelete(scaffoldGraph);
    }
  }
  const scaffolded = scaffoldGraph.toResources();

  const cascadePolicies = discoverDecoratedCascadePolicies(program);
  const annotations = discoverDecoratedAnnotations(program);

  const cascadeResult = expandCascadeDeletePolicies(scaffolded, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  const diagnostics = validatePermissionExpressions(fullSchema);
  const ownedNamespaces = new Set(["rbac"]);
  const spicedbOutput = generateSpiceDB(fullSchema);
  const unifiedJsonSchemas = generateUnifiedJsonSchemas(fullSchema, ownedNamespaces);

  const permissionsByApp: Record<string, string[]> = {};
  for (const er of extensionResults) {
    for (const inst of er.instances) {
      if (inst.application && inst.v2Perm) {
        if (!permissionsByApp[inst.application]) permissionsByApp[inst.application] = [];
        permissionsByApp[inst.application].push(inst.v2Perm);
      }
    }
  }
  const metadataContributions: MetadataContribution[] = [{ permissionsByApp }];

  return {
    resources,
    extensions: extensionResults,
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
