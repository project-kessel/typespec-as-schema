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
import type { ExtensionProvider } from "../../src/provider.js";

import { rbacProvider } from "../../schema/rbac/rbac-provider.js";
import { hbiProvider } from "../../schema/hbi/hbi-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pocRoot = path.resolve(__dirname, "../..");
export const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
export const goldenDir = path.resolve(pocRoot, "test/fixtures");
const distEntry = path.resolve(pocRoot, "dist/src/index.js");

const providers: ExtensionProvider[] = [rbacProvider, hbiProvider];

export interface PipelineResult {
  resources: ResourceDef[];
  providerResults: { providerId: string; discovered: { kind: string; params: Record<string, string> }[] }[];
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
  const providerResults: PipelineResult["providerResults"] = [];
  let currentResources = resources;

  for (const provider of providers) {
    const discovered = provider.discover(program);
    providerResults.push({ providerId: provider.id, discovered });
    const result = provider.expand(currentResources, discovered);
    currentResources = result.resources;
    warnings.push(...result.warnings);
  }

  const preExpansionDiagnostics = validatePreExpansionExpressions(currentResources);
  for (const d of preExpansionDiagnostics) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  for (const provider of providers) {
    if (provider.onBeforeCascadeDelete) {
      currentResources = provider.onBeforeCascadeDelete(currentResources);
    }
  }

  const cascadePolicies = discoverDecoratedCascadePolicies(program);
  const annotations = discoverDecoratedAnnotations(program);

  const cascadeResult = expandCascadeDeletePolicies(currentResources, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  const diagnostics = validatePermissionExpressions(fullSchema);
  const ownedNamespaces = new Set(["rbac"]);
  const spicedbOutput = generateSpiceDB(fullSchema);
  const unifiedJsonSchemas = generateUnifiedJsonSchemas(fullSchema, ownedNamespaces);

  const permissionsByApp: Record<string, string[]> = {};
  for (const pr of providerResults) {
    for (const ext of pr.discovered) {
      if (ext.params.application && ext.params.v2Perm) {
        if (!permissionsByApp[ext.params.application]) permissionsByApp[ext.params.application] = [];
        permissionsByApp[ext.params.application].push(ext.params.v2Perm);
      }
    }
  }
  const metadataContributions: MetadataContribution[] = [{ permissionsByApp }];

  return {
    resources,
    providerResults,
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
