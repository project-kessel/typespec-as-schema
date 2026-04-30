// Schema Safety Guards
//
// Defense-in-depth for schema compilation. TypeSpec's architecture provides
// structural safety (service authors write zero computation — only type
// declarations and alias instantiations), but these guards add runtime
// protection against edge cases in platform-owned expansion code.
//
// Design principle: prevent problems, don't just detect them.
// Each guard runs before or immediately after a pipeline stage,
// failing fast with actionable diagnostics.

import type { V1Extension, ResourceDef } from "./types.js";
import { slotName } from "./utils.js";

// ─── Configuration ──────────────────────────────────────────────────

export interface SafetyLimits {
  /** Maximum number of V1 extensions before expansion is rejected. */
  maxExtensions: number;
  /** Maximum wall-clock milliseconds for expansion. */
  expansionTimeoutMs: number;
  /** SpiceDB output size warning threshold in bytes. */
  outputWarnBytes: number;
  /** SpiceDB output size error threshold in bytes. */
  outputMaxBytes: number;
}

export const DEFAULT_LIMITS: Readonly<SafetyLimits> = {
  maxExtensions: 500,
  expansionTimeoutMs: 10_000,
  outputWarnBytes: 100 * 1024,
  outputMaxBytes: 1024 * 1024,
};

// ─── Pre-expansion: complexity budget ───────────────────────────────

export class SchemaComplexityError extends Error {
  constructor(
    public readonly extensionCount: number,
    public readonly limit: number,
  ) {
    super(
      `Schema complexity exceeded: ${extensionCount} extensions discovered, ` +
      `limit is ${limit}. Each extension generates 7 mutations on RBAC types. ` +
      `Reduce the number of V1WorkspacePermission aliases or raise the limit.`,
    );
    this.name = "SchemaComplexityError";
  }
}

/**
 * Validates extension count before expansion runs.
 * Fails fast with a clear error rather than letting expansion run unbounded.
 */
export function validateComplexityBudget(
  extensions: V1Extension[],
  limits: SafetyLimits = DEFAULT_LIMITS,
): void {
  if (extensions.length > limits.maxExtensions) {
    throw new SchemaComplexityError(extensions.length, limits.maxExtensions);
  }
}

// ─── Expansion timeout ──────────────────────────────────────────────

export class ExpansionTimeoutError extends Error {
  constructor(public readonly elapsedMs: number, public readonly limitMs: number) {
    super(
      `Expansion exceeded ${limitMs}ms timeout (ran for ${elapsedMs}ms). ` +
      `This may indicate a bug in expansion logic. ` +
      `The schema has not been modified.`,
    );
    this.name = "ExpansionTimeoutError";
  }
}

/**
 * @deprecated Inlined into `compilePipeline`. Kept for backward compatibility
 * with external consumers. Prefer using `compilePipeline` with `PipelineOptions`
 * to configure safety limits.
 */
export function withExpansionTimeout<T>(
  fn: () => T,
  limits: SafetyLimits = DEFAULT_LIMITS,
): T {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;

  if (elapsed > limits.expansionTimeoutMs) {
    throw new ExpansionTimeoutError(Math.round(elapsed), limits.expansionTimeoutMs);
  }

  return result;
}

// ─── Post-generation: output size validation ────────────────────────

export interface OutputSizeResult {
  sizeBytes: number;
  warning: string | null;
}

export class OutputSizeError extends Error {
  constructor(public readonly sizeBytes: number, public readonly limitBytes: number) {
    super(
      `Generated SpiceDB schema is ${formatBytes(sizeBytes)}, ` +
      `exceeding the ${formatBytes(limitBytes)} limit. ` +
      `This may indicate combinatorial explosion from too many extensions.`,
    );
    this.name = "OutputSizeError";
  }
}

/**
 * Validates generated output size. Returns a warning string if the output
 * is large but within limits, or throws if it exceeds the hard limit.
 */
export function validateOutputSize(
  output: string,
  limits: SafetyLimits = DEFAULT_LIMITS,
): OutputSizeResult {
  const sizeBytes = Buffer.byteLength(output, "utf-8");

  if (sizeBytes > limits.outputMaxBytes) {
    throw new OutputSizeError(sizeBytes, limits.outputMaxBytes);
  }

  const warning =
    sizeBytes > limits.outputWarnBytes
      ? `SpiceDB schema is ${formatBytes(sizeBytes)} (warning threshold: ${formatBytes(limits.outputWarnBytes)})`
      : null;

  return { sizeBytes, warning };
}

// ─── Permission expression validation ───────────────────────────────

export interface ValidationDiagnostic {
  resource: string;
  relation: string;
  expression: string;
  message: string;
}

/**
 * Validates that all permission expressions reference relations that exist
 * in the expanded schema. Catches typos and stale references that TypeSpec's
 * type checker cannot see (Permission<"expr"> strings are opaque to it).
 */
export function validatePermissionExpressions(
  resources: ResourceDef[],
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  // Build an index of all known relation and permission names per resource
  const relationIndex = new Map<string, Set<string>>();
  for (const res of resources) {
    const key = `${res.namespace}/${res.name}`;
    const names = new Set(res.relations.map((r) => r.name));
    for (const rel of res.relations) {
      names.add(slotName(rel.name));
    }
    relationIndex.set(key, names);
  }

  // Collect all relation names across all resources (flat set for subref targets)
  const allRelationNames = new Set<string>();
  for (const res of resources) {
    for (const rel of res.relations) {
      allRelationNames.add(rel.name);
      allRelationNames.add(slotName(rel.name));
    }
  }

  // Map local relation names to their target types for subref resolution.
  // Key: "resourceKey.t_relName", Value: target type key (e.g., "rbac/workspace")
  const targetTypeMap = new Map<string, string>();
  for (const res of resources) {
    const rk = `${res.namespace}/${res.name}`;
    for (const rel of res.relations) {
      if (rel.body.kind === "assignable" || rel.body.kind === "bool") {
        targetTypeMap.set(`${rk}.${slotName(rel.name)}`, rel.body.target);
      }
    }
  }

  for (const res of resources) {
    const resourceKey = `${res.namespace}/${res.name}`;
    const localNames = relationIndex.get(resourceKey)!;

    for (const rel of res.relations) {
      validateBody(rel.body, resourceKey, rel.name, localNames, allRelationNames, relationIndex, targetTypeMap, diagnostics);
    }
  }

  return diagnostics;
}

function validateBody(
  body: import("./types.js").RelationBody,
  resourceKey: string,
  relationName: string,
  localNames: Set<string>,
  allNames: Set<string>,
  relationIndex: Map<string, Set<string>>,
  targetTypeMap: Map<string, string>,
  diagnostics: ValidationDiagnostic[],
): void {
  switch (body.kind) {
    case "ref":
      if (!localNames.has(body.name) && !localNames.has(slotName(body.name))) {
        diagnostics.push({
          resource: resourceKey,
          relation: relationName,
          expression: body.name,
          message: `Unknown reference "${body.name}" in ${resourceKey}.${relationName}`,
        });
      }
      break;

    case "subref": {
      // The left side (e.g., t_workspace) should be a local relation
      if (!localNames.has(body.name)) {
        diagnostics.push({
          resource: resourceKey,
          relation: relationName,
          expression: `${body.name}->${body.subname}`,
          message: `Unknown relation "${body.name}" in ${resourceKey}.${relationName}`,
        });
        break;
      }
      // Resolve the target type and check the right-hand side against it
      const targetType = targetTypeMap.get(`${resourceKey}.${body.name}`);
      if (targetType) {
        const targetNames = relationIndex.get(targetType);
        if (targetNames && !targetNames.has(body.subname) && !targetNames.has(slotName(body.subname))) {
          diagnostics.push({
            resource: resourceKey,
            relation: relationName,
            expression: `${body.name}->${body.subname}`,
            message: `"${body.subname}" does not exist on target type "${targetType}" (referenced via ${body.name} in ${resourceKey}.${relationName})`,
          });
        }
        // If targetType is not in relationIndex, it's an external/platform type -- skip
      } else if (!allNames.has(body.subname)) {
        diagnostics.push({
          resource: resourceKey,
          relation: relationName,
          expression: `${body.name}->${body.subname}`,
          message: `Unknown sub-relation "${body.subname}" referenced via ${body.name} in ${resourceKey}.${relationName}`,
        });
      }
      break;
    }

    case "or":
    case "and":
      for (const member of body.members) {
        validateBody(member, resourceKey, relationName, localNames, allNames, relationIndex, targetTypeMap, diagnostics);
      }
      break;

    // assignable and bool are always valid (they define, not reference)
    case "assignable":
    case "bool":
      break;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
