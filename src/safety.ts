// Schema Safety Guards
//
// Defense-in-depth for schema compilation. Service authors write zero
// computation (only type declarations and alias instantiations). Providers
// ship reviewed expansion code with declared cost budgets. These guards
// enforce per-provider budgets and catch edge cases in expansion code.

import type { ResourceDef } from "./types.js";
import type { DiscoveredExtension, ExtensionProvider } from "./provider.js";
import { slotName } from "./utils.js";

// ─── Configuration ──────────────────────────────────────────────────

export interface SafetyLimits {
  /** Maximum total weighted cost before expansion is rejected. */
  maxExpansionCost: number;
  /** Maximum wall-clock milliseconds for expansion. */
  expansionTimeoutMs: number;
  /** Maximum wall-clock milliseconds for a single provider's discover() call. */
  discoveryTimeoutMs: number;
  /** SpiceDB output size warning threshold in bytes. */
  outputWarnBytes: number;
  /** SpiceDB output size error threshold in bytes. */
  outputMaxBytes: number;
}

export const DEFAULT_LIMITS: Readonly<SafetyLimits> = {
  maxExpansionCost: 500,
  expansionTimeoutMs: 10_000,
  discoveryTimeoutMs: 10_000,
  outputWarnBytes: 100 * 1024,
  outputMaxBytes: 1024 * 1024,
};

// ─── Pre-expansion: complexity budget ───────────────────────────────

export class SchemaComplexityError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly extensionCount: number,
    public readonly totalCost: number,
    public readonly limit: number,
  ) {
    super(
      `Schema complexity exceeded for provider "${providerId}": ` +
      `${extensionCount} extensions with total cost ${totalCost}, ` +
      `limit is ${limit}. ` +
      `Reduce the number of extension aliases or raise the limit.`,
    );
    this.name = "SchemaComplexityError";
  }
}

/**
 * Validates extension count and weighted cost for a single provider.
 * costPerInstance defaults to 1 if not specified by the provider.
 */
export function validateProviderComplexityBudget(
  discovered: DiscoveredExtension[],
  provider: ExtensionProvider,
  limits: SafetyLimits = DEFAULT_LIMITS,
): void {
  const cost = provider.costPerInstance ?? 1;
  const totalCost = discovered.length * cost;
  if (totalCost > limits.maxExpansionCost) {
    throw new SchemaComplexityError(provider.id, discovered.length, totalCost, limits.maxExpansionCost);
  }
}

// ─── Expansion timeout ──────────────────────────────────────────────

export class ExpansionTimeoutError extends Error {
  constructor(public readonly elapsedMs: number, public readonly limitMs: number) {
    super(
      `Expansion exceeded ${limitMs}ms timeout (ran for ${elapsedMs}ms). ` +
      `This may indicate a bug in provider expansion logic. ` +
      `The schema has not been modified.`,
    );
    this.name = "ExpansionTimeoutError";
  }
}

export class DiscoveryTimeoutError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly elapsedMs: number,
    public readonly limitMs: number,
  ) {
    super(
      `Discovery for provider "${providerId}" exceeded ${limitMs}ms timeout ` +
      `(ran for ${elapsedMs}ms). This may indicate a bug in provider discovery logic.`,
    );
    this.name = "DiscoveryTimeoutError";
  }
}

/**
 * @deprecated Inlined into `compilePipeline`. Kept for backward compatibility.
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

// ─── Pre-expansion permission expression validation ─────────────────

/**
 * Validates permission expressions before expansion runs. Checks that
 * subrefs have a valid left-hand side. Right-hand side validation is
 * deferred to post-expansion because provider mutations haven't been
 * applied yet.
 */
export function validatePreExpansionExpressions(
  resources: ResourceDef[],
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  for (const res of resources) {
    const resourceKey = `${res.namespace}/${res.name}`;
    const localNames = new Set<string>();
    for (const rel of res.relations) {
      localNames.add(rel.name);
      localNames.add(slotName(rel.name));
    }

    for (const rel of res.relations) {
      validatePreExpansionBody(rel.body, resourceKey, rel.name, localNames, diagnostics);
    }
  }

  return diagnostics;
}

function validatePreExpansionBody(
  body: import("./types.js").RelationBody,
  resourceKey: string,
  relationName: string,
  localNames: Set<string>,
  diagnostics: ValidationDiagnostic[],
): void {
  switch (body.kind) {
    case "ref":
      if (!localNames.has(body.name) && !localNames.has(slotName(body.name))) {
        diagnostics.push({
          resource: resourceKey,
          relation: relationName,
          expression: body.name,
          message: `Unknown reference "${body.name}" in ${resourceKey}.${relationName} (pre-expansion)`,
        });
      }
      break;

    case "subref":
      if (!localNames.has(body.name)) {
        diagnostics.push({
          resource: resourceKey,
          relation: relationName,
          expression: `${body.name}->${body.subname}`,
          message: `Unknown relation "${body.name}" in ${resourceKey}.${relationName} (pre-expansion)`,
        });
      }
      break;

    case "or":
    case "and":
      for (const member of body.members) {
        validatePreExpansionBody(member, resourceKey, relationName, localNames, diagnostics);
      }
      break;

    case "assignable":
    case "bool":
      break;
  }
}

// ─── Post-expansion permission expression validation ────────────────

export interface ValidationDiagnostic {
  resource: string;
  relation: string;
  expression: string;
  message: string;
}

export function validatePermissionExpressions(
  resources: ResourceDef[],
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  const relationIndex = new Map<string, Set<string>>();
  for (const res of resources) {
    const key = `${res.namespace}/${res.name}`;
    const names = new Set(res.relations.map((r) => r.name));
    for (const rel of res.relations) {
      names.add(slotName(rel.name));
    }
    relationIndex.set(key, names);
  }

  const allRelationNames = new Set<string>();
  for (const res of resources) {
    for (const rel of res.relations) {
      allRelationNames.add(rel.name);
      allRelationNames.add(slotName(rel.name));
    }
  }

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
      if (!localNames.has(body.name)) {
        diagnostics.push({
          resource: resourceKey,
          relation: relationName,
          expression: `${body.name}->${body.subname}`,
          message: `Unknown relation "${body.name}" in ${resourceKey}.${relationName}`,
        });
        break;
      }
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
