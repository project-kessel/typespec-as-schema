// Extension Instance Discovery
//
// Reusable plumbing for finding template instances in a compiled TypeSpec
// program. Both providers and platform-owned discovery call these utilities.

import {
  navigateProgram,
  isTemplateInstance,
  type Program,
  type Model,
  type Namespace,
  type Type,
} from "@typespec/compiler";
import { getNamespaceFQN } from "./utils.js";
import type { ExtensionTemplateDef } from "./registry.js";

// ─── String value extraction ─────────────────────────────────────────

function hasStringValue(t: Type): t is Type & { value: string } {
  return "value" in t && typeof (t as unknown as Record<string, unknown>).value === "string";
}

function getStringValue(t: Type): string | undefined {
  if (hasStringValue(t)) return t.value;
  if (t.kind === "Scalar" && t.name) return t.name;
  return undefined;
}

function extractParams(model: Model, names: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const name of names) {
    const prop = model.properties.get(name);
    if (prop) {
      const value = getStringValue(prop.type);
      if (value) params[name] = value;
    }
  }
  return params;
}

// ─── Extension template lookup ───────────────────────────────────────

/** Find an extension template by name, optionally scoped to a namespace suffix. */
export function findExtensionTemplate(
  program: Program,
  templateName: string,
  namespace?: string,
): Model | null {
  const globalNs = program.getGlobalNamespaceType();
  function search(ns: Namespace): Model | null {
    for (const [, model] of ns.models) {
      if (model.name === templateName &&
          (!namespace || getNamespaceFQN(ns).endsWith(namespace))) {
        return model;
      }
    }
    for (const [, childNs] of ns.namespaces) {
      const found = search(childNs);
      if (found) return found;
    }
    return null;
  }
  return search(globalNs);
}

export function isInstanceOf(model: Model, template: Model): boolean {
  if (!isTemplateInstance(model)) return false;
  if (model.sourceModel === template) return true;
  if (model.templateNode === template.node) return true;
  if (
    model.name === template.name &&
    getNamespaceFQN(model.namespace) === getNamespaceFQN(template.namespace)
  ) {
    return true;
  }
  return false;
}

// ─── Generic extension instance discovery ────────────────────────────

interface DiscoverInstancesResult {
  results: Record<string, string>[];
  skipped: string[];
  aliasesAttempted: number;
  aliasesResolved: number;
}

/**
 * Generic discovery utility: finds instances of a template in the compiled program.
 * Providers call this to discover their extension instances.
 */
export function discoverExtensionInstances(
  program: Program,
  def: ExtensionTemplateDef,
): DiscoverInstancesResult {
  const { templateName, paramNames, namespace } = def;
  const template = findExtensionTemplate(program, templateName, namespace);
  if (!template) {
    return {
      results: [],
      skipped: [`Template "${templateName}" (namespace: ${namespace ?? "any"}) not found in compiled program`],
      aliasesAttempted: 0,
      aliasesResolved: 0,
    };
  }

  const results: Record<string, string>[] = [];
  const seen = new Set<string>();
  const skipped: string[] = [];

  function addUnique(model: Model): void {
    if (!isInstanceOf(model, template!)) return;
    const params = extractParams(model, paramNames);
    if (Object.keys(params).length === 0) {
      const modelId = model.name || "(anonymous)";
      skipped.push(`Matched template "${templateName}" but extracted no params from model "${modelId}"`);
      return;
    }
    const key = JSON.stringify(params);
    if (seen.has(key)) return;
    seen.add(key);
    results.push(params);
  }

  navigateProgram(program, {
    model(model: Model) {
      if (model.templateNode && !isTemplateInstance(model)) return;
      if (getNamespaceFQN(model.namespace).endsWith("Kessel")) return;
      addUnique(model);
    },
  });

  let aliasesAttempted = 0;
  let aliasesResolved = 0;

  for (const [, sourceFile] of program.sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!("value" in statement && "id" in statement)) continue;
      aliasesAttempted++;
      try {
        const aliasType = program.checker.getTypeForNode(statement);
        if (!aliasType || aliasType.kind !== "Model") continue;
        aliasesResolved++;
        addUnique(aliasType as Model);
      } catch (e: unknown) {
        if (isExpectedResolutionError(e)) {
          skipped.push(`Skipped statement in ${templateName} discovery: ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }
        throw e;
      }
    }
  }

  return { results, skipped, aliasesAttempted, aliasesResolved };
}

/**
 * Classifies errors thrown during alias resolution. Prefers structured
 * properties (`code`, `diagnosticCode`) over message text matching.
 * Falls back to a regex for older TypeSpec versions that throw plain Errors.
 */
function isExpectedResolutionError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;

  const record = e as unknown as Record<string, unknown>;
  if (typeof record.code === "string") {
    const knownCodes = ["unresolved-type", "unknown-identifier", "invalid-ref"];
    if (knownCodes.includes(record.code)) return true;
  }
  if (typeof record.diagnosticCode === "string") return true;

  return /cannot|not found|resolve/i.test(e.message);
}
