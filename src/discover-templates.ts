// Platform Template Discovery
//
// Generic machinery for finding TypeSpec template instances and resolved
// aliases across a compiled program. Providers declare *what* template
// they own (via TemplateDef); this module handles *how* to find instances.
//
// All internal compiler API usage (program.checker, AST traversal,
// template introspection) is centralized here so providers never
// touch compiler internals directly.

import {
  navigateProgram,
  isTemplateInstance,
  type Program,
  type Model,
  type Namespace,
} from "@typespec/compiler";
import { getNamespaceFQN, extractParams } from "./utils.js";

// ─── Public types ────────────────────────────────────────────────────

export interface TemplateDef {
  templateName: string;
  paramNames: string[];
  namespace: string;
}

export interface TemplateDiscoveryResult {
  results: Record<string, string>[];
  skipped: string[];
  aliasesAttempted: number;
  aliasesResolved: number;
}

// ─── Namespace / template lookup ─────────────────────────────────────

function findTemplate(program: Program, templateName: string, namespace?: string): Model | null {
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

function isInstanceOfTemplate(model: Model, template: Model): boolean {
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

// ─── Main discovery function ─────────────────────────────────────────

/**
 * Walks a compiled TypeSpec program to find all instances of a given
 * template, including those declared via `alias`. Returns extracted
 * parameter bags, deduplicated by value.
 */
export function discoverTemplateInstances(
  program: Program,
  def: TemplateDef,
): TemplateDiscoveryResult {
  const { templateName, paramNames, namespace } = def;
  const template = findTemplate(program, templateName, namespace);
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
    if (!isInstanceOfTemplate(model, template!)) return;
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
