// Compilation Pipeline
//
// Provider-driven pipeline that orchestrates discovery, validation,
// expansion, and generation. The pipeline is provider-neutral — it does
// not import or hard-code any domain-specific expansion logic. Callers
// (CLI, tests) supply the provider list via PipelineOptions.providers.

import { compile, NodeHost, type Program, type CompilerOptions } from "@typespec/compiler";
import type { ResourceDef, UnifiedJsonSchema, CascadeDeleteEntry, AnnotationEntry, ProviderDiscoveryResult } from "./types.js";
import { discoverResources } from "./discover-resources.js";
import {
  discoverAnnotations,
  discoverCascadeDeletePolicies,
  type DiscoveryWarnings,
} from "./discover-platform.js";
import { generateSpiceDB, generateUnifiedJsonSchemas } from "./generate.js";
import { expandCascadeDeletePolicies } from "./expand-cascade.js";
import {
  validateProviderComplexityBudget,
  validatePreExpansionExpressions,
  validatePermissionExpressions,
  validateOutputSize,
  ExpansionTimeoutError,
  DiscoveryTimeoutError,
  DEFAULT_LIMITS,
  type SafetyLimits,
  type ValidationDiagnostic,
} from "./safety.js";
import type { ExtensionProvider } from "./provider.js";
import { buildRegistry } from "./registry.js";

export interface PipelineOptions {
  limits?: Partial<SafetyLimits>;
  /** When true, also runs the @typespec/json-schema emitter during compilation. */
  emitJsonSchema?: boolean;
  /** Output directory for emitters (defaults to tsp-output next to the main file). */
  outputDir?: string;
  /** Extension providers to use. The composition root (CLI, tests) must supply these. */
  providers: ExtensionProvider[];
}

export type { ProviderDiscoveryResult } from "./types.js";

export interface PipelineResult {
  resources: ResourceDef[];
  providerResults: ProviderDiscoveryResult[];
  providerMap: ReadonlyMap<string, ExtensionProvider>;
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

/**
 * Compiles a TypeSpec schema and runs the full discovery/validation/expansion
 * pipeline. This is the single source of truth for the pipeline — both the CLI
 * and tests call this function.
 */
export async function compilePipeline(
  mainFile: string,
  options: PipelineOptions,
): Promise<PipelineResult> {
  const limits: SafetyLimits = { ...DEFAULT_LIMITS, ...options?.limits };
  const providers = options.providers;

  const seenIds = new Set<string>();
  for (const p of providers) {
    if (seenIds.has(p.id)) {
      throw new Error(
        `Duplicate provider ID "${p.id}". Each provider must have a unique ID.`,
      );
    }
    seenIds.add(p.id);
  }

  const providerMap = new Map(providers.map((p) => [p.id, p]));

  const compilerOpts: CompilerOptions = { noEmit: true };
  if (options?.emitJsonSchema) {
    compilerOpts.noEmit = false;
    compilerOpts.emit = ["@typespec/json-schema"];
    if (options.outputDir) {
      compilerOpts.outputDir = options.outputDir;
    }
  }

  const program: Program = await compile(NodeHost, mainFile, compilerOpts);
  const hasErrors = program.diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    const msgs = program.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    throw new Error(`Compilation failed:\n${msgs.join("\n")}`);
  }

  const warnings: string[] = [];
  const discoveryWarnings: DiscoveryWarnings = {
    skipped: [],
    stats: { aliasesAttempted: 0, aliasesResolved: 0, resourcesFound: 0, extensionsFound: 0 },
  };

  // ─── Resource discovery (generic) ────────────────────────────────
  const registryResult = buildRegistry(providers);
  warnings.push(...registryResult.warnings);
  const { resources } = discoverResources(program, registryResult.templates);
  discoveryWarnings.stats.resourcesFound = resources.length;

  // ─── Provider discovery ──────────────────────────────────────────
  const providerResults: ProviderDiscoveryResult[] = [];
  for (const provider of providers) {
    const discoverStart = performance.now();
    const discovered = provider.discover(program);
    const discoverElapsed = performance.now() - discoverStart;
    if (discoverElapsed > limits.discoveryTimeoutMs) {
      throw new DiscoveryTimeoutError(provider.id, Math.round(discoverElapsed), limits.discoveryTimeoutMs);
    }
    providerResults.push({ providerId: provider.id, discovered });
    discoveryWarnings.stats.extensionsFound += discovered.length;
  }

  // ─── Platform discovery (annotations, cascade) ───────────────────
  const annotations = discoverAnnotations(program, discoveryWarnings);
  const cascadePolicies = discoverCascadeDeletePolicies(program, discoveryWarnings);

  warnings.push(...discoveryWarnings.skipped);

  const { stats } = discoveryWarnings;
  if (discoveryWarnings.skipped.length > 0) {
    warnings.push(
      `Alias resolution: ${stats.aliasesResolved}/${stats.aliasesAttempted} resolved, ` +
      `${stats.aliasesAttempted - stats.aliasesResolved} skipped`,
    );
  }

  // ─── Namespace cross-check (provider-driven) ────────────────────
  const knownNamespaces = new Set(resources.map((r) => r.namespace));
  for (const pr of providerResults) {
    const provider = providerMap.get(pr.providerId)!;
    const paramKey = provider.applicationParamKey;
    if (!paramKey) continue;
    for (const ext of pr.discovered) {
      const app = ext.params[paramKey];
      if (app && !knownNamespaces.has(app)) {
        warnings.push(`extension ${paramKey} "${app}" has no matching resource namespace`);
      }
    }
  }

  // ─── Complexity budget per provider ──────────────────────────────
  for (const pr of providerResults) {
    const provider = providerMap.get(pr.providerId)!;
    validateProviderComplexityBudget(pr.discovered, provider, limits);
  }

  // ─── Pre-expansion validation ────────────────────────────────────
  const preExpansionDiags = validatePreExpansionExpressions(resources);
  if (preExpansionDiags.length > 0) {
    for (const d of preExpansionDiags) {
      warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
    }
  }

  // ─── Provider expansion loop ─────────────────────────────────────
  const expansionStart = performance.now();
  let currentResources = resources;
  for (const pr of providerResults) {
    const provider = providerMap.get(pr.providerId)!;
    const result = provider.expand(currentResources, pr.discovered);
    currentResources = result.resources;
    warnings.push(...result.warnings);
  }

  // ─── Cascade-delete expansion ────────────────────────────────────
  for (const provider of providers) {
    if (provider.onBeforeCascadeDelete) {
      currentResources = provider.onBeforeCascadeDelete(currentResources);
    }
  }
  const cascadeResult = expandCascadeDeletePolicies(currentResources, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  const expansionElapsed = performance.now() - expansionStart;
  if (expansionElapsed > limits.expansionTimeoutMs) {
    throw new ExpansionTimeoutError(Math.round(expansionElapsed), limits.expansionTimeoutMs);
  }

  // ─── Post-expansion validation ───────────────────────────────────
  const diagnostics = validatePermissionExpressions(fullSchema);
  const spicedbOutput = generateSpiceDB(fullSchema);

  const outputSizeResult = validateOutputSize(spicedbOutput, limits);
  if (outputSizeResult.warning) {
    warnings.push(outputSizeResult.warning);
  }

  const ownedNamespaces = new Set(providers.flatMap((p) => p.ownedNamespaces ?? []));
  const unifiedJsonSchemas = generateUnifiedJsonSchemas(fullSchema, ownedNamespaces);

  return {
    resources,
    providerResults,
    providerMap,
    annotations,
    cascadePolicies,
    fullSchema,
    spicedbOutput,
    unifiedJsonSchemas,
    preExpansionDiagnostics: preExpansionDiags,
    diagnostics,
    warnings,
    ownedNamespaces,
  };
}
