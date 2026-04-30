import { compile, NodeHost, type Program, type CompilerOptions } from "@typespec/compiler";
import type { ResourceDef, V1Extension, UnifiedJsonSchema, CascadeDeleteEntry, AnnotationEntry } from "./types.js";
import {
  discoverResources,
  discoverV1Permissions,
  discoverAnnotations,
  discoverCascadeDeletePolicies,
  type DiscoveryWarnings,
} from "./discover.js";
import { generateSpiceDB, generateUnifiedJsonSchemas } from "./generate.js";
import {
  expandV1Permissions,
  expandCascadeDeletePolicies,
} from "./expand.js";
import {
  validateComplexityBudget,
  validatePreExpansionExpressions,
  validatePermissionExpressions,
  validateOutputSize,
  ExpansionTimeoutError,
  DEFAULT_LIMITS,
  type SafetyLimits,
  type ValidationDiagnostic,
} from "./safety.js";

export interface PipelineOptions {
  limits?: Partial<SafetyLimits>;
  /** When true, also runs the @typespec/json-schema emitter during compilation. */
  emitJsonSchema?: boolean;
  /** Output directory for emitters (defaults to tsp-output next to the main file). */
  outputDir?: string;
}

export interface PipelineResult {
  resources: ResourceDef[];
  extensions: V1Extension[];
  annotations: Map<string, AnnotationEntry[]>;
  cascadePolicies: CascadeDeleteEntry[];
  fullSchema: ResourceDef[];
  spicedbOutput: string;
  unifiedJsonSchemas: Record<string, UnifiedJsonSchema>;
  diagnostics: ValidationDiagnostic[];
  warnings: string[];
}

/**
 * Compiles a TypeSpec schema and runs the full discovery/validation/expansion
 * pipeline. This is the single source of truth for the pipeline — both the CLI
 * and tests call this function.
 */
export async function compilePipeline(
  mainFile: string,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const limits: SafetyLimits = { ...DEFAULT_LIMITS, ...options?.limits };

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

  const { resources } = discoverResources(program);
  discoveryWarnings.stats.resourcesFound = resources.length;

  const extensions = discoverV1Permissions(program, discoveryWarnings);
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

  const knownNamespaces = new Set(resources.map((r) => r.namespace));
  for (const perm of extensions) {
    if (!knownNamespaces.has(perm.application)) {
      warnings.push(`extension application "${perm.application}" has no matching resource namespace`);
    }
  }

  validateComplexityBudget(extensions, limits);

  const preExpansionDiags = validatePreExpansionExpressions(resources);
  if (preExpansionDiags.length > 0) {
    for (const d of preExpansionDiags) {
      warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
    }
  }

  const expansionStart = performance.now();
  const { resources: expanded, warnings: expansionWarnings } = expandV1Permissions(resources, extensions);
  warnings.push(...expansionWarnings);
  const fullSchema = expandCascadeDeletePolicies(expanded, cascadePolicies);
  const expansionElapsed = performance.now() - expansionStart;
  if (expansionElapsed > limits.expansionTimeoutMs) {
    throw new ExpansionTimeoutError(Math.round(expansionElapsed), limits.expansionTimeoutMs);
  }

  const diagnostics = validatePermissionExpressions(fullSchema);
  const spicedbOutput = generateSpiceDB(fullSchema);

  const outputSizeResult = validateOutputSize(spicedbOutput, limits);
  if (outputSizeResult.warning) {
    warnings.push(outputSizeResult.warning);
  }

  const unifiedJsonSchemas = generateUnifiedJsonSchemas(fullSchema);

  return {
    resources,
    extensions,
    annotations,
    cascadePolicies,
    fullSchema,
    spicedbOutput,
    unifiedJsonSchemas,
    diagnostics,
    warnings,
  };
}
