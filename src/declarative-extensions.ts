// Declarative Extension Applicator (Option A)
//
// Reads structured patch declarations from V1WorkspacePermission template
// instances and applies them generically to ResourceDef[], replacing the
// hardcoded buildSchemaFromTypeGraph().
//
// The patch rules live in TypeSpec (owned by the RBAC team) via the
// kessel-extensions.tsp library. This emitter code is extension-agnostic:
// it knows how to parse patch-rule syntax (boolRelations, permission,
// public, accumulate, addField) but has zero knowledge of specific
// extension patterns like workspace_permission or view_metadata.

import type { Program, Model, Type, Namespace } from "@typespec/compiler";
import { isTemplateInstance } from "@typespec/compiler";
import type { ResourceDef, RelationDef, RelationBody } from "./lib.js";
import { getNamespaceFQN, parsePermissionExpr } from "./lib.js";

// ─── Errors ───────────────────────────────────────────────────────────

export class ExtensionPatchError extends Error {
  constructor(
    message: string,
    readonly context?: Record<string, string>,
  ) {
    super(message);
    this.name = "ExtensionPatchError";
  }
}

function failPatch(
  strict: boolean,
  message: string,
  ctx?: Record<string, string>,
): void {
  if (!strict) return;
  throw new ExtensionPatchError(message, ctx);
}

// ─── Declarative Extension Instance ──────────────────────────────────

export interface DeclaredExtension {
  params: Record<string, string>;
  patchRules: PatchRule[];
}

export interface PatchRule {
  target: string;       // "role" | "roleBinding" | "workspace" | "jsonSchema"
  patchType: string;    // "boolRelations" | "permission" | "public" | "accumulate" | "addField"
  rawValue: string;     // template with {app}, {res}, {verb}, {v2} placeholders
}

// ─── Accumulate Rule ─────────────────────────────────────────────────

export interface AccumulateRule {
  name: string;         // target relation name (e.g., "view_metadata")
  op: string;           // merge operator (e.g., "or")
  ref: string;          // per-instance ref template (e.g., "{v2}")
  condition?: {         // optional gate (e.g., {verb}==read)
    param: string;      // param placeholder (e.g., "{verb}")
    value: string;      // required value (e.g., "read")
  };
  isPublic?: boolean;
}

export function parseAccumulateRule(raw: string): AccumulateRule | null {
  // Format: "name=op(ref),when=condition,public=bool"
  // Example: "view_metadata=or({v2}),when={verb}==read,public=true"
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length === 0) return null;

  // First part: name=op(ref)
  const defMatch = parts[0].match(/^(\w+)=(\w+)\(([^)]+)\)$/);
  if (!defMatch) return null;

  const rule: AccumulateRule = {
    name: defMatch[1],
    op: defMatch[2],
    ref: defMatch[3],
  };

  for (let i = 1; i < parts.length; i++) {
    const kv = parts[i];
    if (kv.startsWith("when=")) {
      const cond = kv.slice(5); // e.g., "{verb}==read"
      const eqIdx = cond.indexOf("==");
      if (eqIdx !== -1) {
        rule.condition = {
          param: cond.slice(0, eqIdx),
          value: cond.slice(eqIdx + 2),
        };
      }
    } else if (kv.startsWith("public=")) {
      rule.isPublic = kv.slice(7) === "true";
    }
  }

  return rule;
}

// ─── JSON Schema Field Rule ──────────────────────────────────────────

export interface JsonSchemaFieldRule {
  fieldName: string;
  fieldType: string;
  format?: string;
  required: boolean;
  /** Present when emitted from V1WorkspacePermission: limits Unified JSON Schema targets. */
  application?: string;
  /** Template `resource` param (e.g. hosts); used with application to narrow the model. */
  resource?: string;
}

export function parseJsonSchemaFieldRule(raw: string): JsonSchemaFieldRule | null {
  // Format: "name=type:format,required=bool"
  // Example: "inventory_host_view_id=string:uuid,required=true"
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length === 0) return null;

  // First part: name=type[:format]
  const defMatch = parts[0].match(/^([\w{}]+)=([\w]+)(?::([\w]+))?$/);
  if (!defMatch) return null;

  const rule: JsonSchemaFieldRule = {
    fieldName: defMatch[1],
    fieldType: defMatch[2],
    format: defMatch[3],
    required: false,
  };

  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith("required=")) {
      rule.required = parts[i].slice(9) === "true";
    }
  }

  return rule;
}

// ─── Discovery ───────────────────────────────────────────────────────

function getStringValue(t: Type): string | undefined {
  if ("value" in t && typeof (t as any).value === "string") {
    return (t as any).value;
  }
  if (t.kind === "Scalar" && t.name) return t.name;
  return undefined;
}

function findExtensionTemplate(program: Program, templateName: string): Model | null {
  const globalNs = program.getGlobalNamespaceType();
  function search(ns: Namespace): Model | null {
    for (const [, model] of ns.models) {
      if (model.name === templateName) return model;
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

const PARAM_NAMES = ["application", "resource", "verb", "v2Perm"] as const;
const PATCH_TARGETS = ["role", "roleBinding", "workspace", "jsonSchema"] as const;

export function discoverDeclaredExtensions(program: Program): DeclaredExtension[] {
  const template = findExtensionTemplate(program, "V1WorkspacePermission");
  if (!template) return [];

  const results: DeclaredExtension[] = [];
  const seen = new Set<string>();

  for (const [, sourceFile] of program.sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!("value" in statement && "id" in statement)) continue;
      try {
        const aliasType = program.checker.getTypeForNode(statement);
        if (!aliasType || aliasType.kind !== "Model") continue;
        if (!isInstanceOfTemplate(aliasType as Model, template)) continue;

        const model = aliasType as Model;
        const params: Record<string, string> = {};
        const patchRules: PatchRule[] = [];

        for (const [name, prop] of model.properties) {
          const value = getStringValue(prop.type);
          if (!value) continue;

          if ((PARAM_NAMES as readonly string[]).includes(name)) {
            params[name] = value;
            continue;
          }

          const separatorIdx = name.indexOf("_");
          if (separatorIdx === -1) continue;

          const target = name.slice(0, separatorIdx);
          const patchType = name.slice(separatorIdx + 1);

          if ((PATCH_TARGETS as readonly string[]).includes(target)) {
            patchRules.push({ target, patchType, rawValue: value });
          }
        }

        const key = params.v2Perm ?? JSON.stringify(params);
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ params, patchRules });
        }
      } catch {
        // Skip nodes that can't be resolved
      }
    }
  }

  return results;
}

// ─── Interpolation ───────────────────────────────────────────────────

function interpolate(template: string, params: Record<string, string>): string {
  return template
    .replace(/\{app\}/g, params.application ?? "")
    .replace(/\{res\}/g, params.resource ?? "")
    .replace(/\{verb\}/g, params.verb ?? "")
    .replace(/\{v2\}/g, params.v2Perm ?? "");
}

// ─── Patch Rule Parsing ──────────────────────────────────────────────

function parseBoolRelations(value: string): RelationDef[] {
  return value.split(",").map((name) => ({
    name: name.trim(),
    body: { kind: "bool" as const, target: "rbac/principal" },
  }));
}

function parsePermissionRule(value: string): RelationDef | null {
  const eqIdx = value.indexOf("=");
  if (eqIdx === -1) return null;

  const name = value.slice(0, eqIdx);
  const bodyExpr = value.slice(eqIdx + 1);
  const body = parsePermissionExpr(bodyExpr);
  if (!body) return null;

  return { name, body };
}

// ─── Result Types ────────────────────────────────────────────────────

export interface DeclaredPatchResult {
  resources: ResourceDef[];
  jsonSchemaFields: JsonSchemaFieldRule[];
}

export interface ApplyDeclaredPatchesOptions {
  /** When true (default), unparseable patch rules throw ExtensionPatchError. */
  strict?: boolean;
}

// ─── Application ─────────────────────────────────────────────────────

export function applyDeclaredPatches(
  resources: ResourceDef[],
  extensions: DeclaredExtension[],
  options?: ApplyDeclaredPatchesOptions,
): DeclaredPatchResult {
  const strict = options?.strict !== false;
  const roleExtra: RelationDef[] = [];
  const roleBindingExtra: RelationDef[] = [];
  const workspaceExtra: RelationDef[] = [];
  const publicPerms = new Set<string>();
  const addedBoolPerms = new Set<string>();

  // Two-pass accumulators: keyed by "target/name" (e.g., "workspace/view_metadata")
  const accumulators = new Map<string, { rule: AccumulateRule; refs: string[] }>();

  // JSON Schema field patches
  const jsonSchemaFields: JsonSchemaFieldRule[] = [];

  // ── Pass 1: Collect per-instance patches and accumulator contributions ──

  for (const ext of extensions) {
    for (const rule of ext.patchRules) {
      const value = interpolate(rule.rawValue, ext.params);

      if (rule.patchType === "boolRelations") {
        if (rule.target === "role") {
          for (const rel of parseBoolRelations(value)) {
            if (!addedBoolPerms.has(rel.name)) {
              addedBoolPerms.add(rel.name);
              roleExtra.push(rel);
            }
          }
        }
      } else if (rule.patchType === "permission") {
        const rel = parsePermissionRule(value);
        if (!rel) {
          failPatch(
            strict,
            `Invalid permission patch rule for extension ${ext.params.v2Perm ?? "?"} (${rule.target}): ${JSON.stringify(value)}`,
            { v2Perm: ext.params.v2Perm ?? "", target: rule.target, raw: value },
          );
          continue;
        }

        if (rule.target === "role") roleExtra.push(rel);
        else if (rule.target === "roleBinding") roleBindingExtra.push(rel);
        else if (rule.target === "workspace") {
          rel.isPublic = publicPerms.has(rel.name);
          workspaceExtra.push(rel);
        }
      } else if (rule.patchType === "public") {
        publicPerms.add(value);
      } else if (rule.patchType === "accumulate") {
        const parsed = parseAccumulateRule(rule.rawValue);
        if (!parsed) {
          failPatch(
            strict,
            `Invalid accumulate patch rule for extension ${ext.params.v2Perm ?? "?"} (${rule.target}): ${JSON.stringify(rule.rawValue)}`,
            { v2Perm: ext.params.v2Perm ?? "", target: rule.target, raw: rule.rawValue },
          );
          continue;
        }

        const key = `${rule.target}/${parsed.name}`;
        if (!accumulators.has(key)) {
          accumulators.set(key, { rule: parsed, refs: [] });
        }

        const acc = accumulators.get(key)!;
        const ref = interpolate(parsed.ref, ext.params);

        if (parsed.condition) {
          const paramValue = interpolate(parsed.condition.param, ext.params);
          if (paramValue === parsed.condition.value) {
            acc.refs.push(ref);
          }
        } else {
          acc.refs.push(ref);
        }
      } else if (rule.target === "jsonSchema" && rule.patchType === "addField") {
        const parsed = parseJsonSchemaFieldRule(value);
        if (!parsed) {
          failPatch(
            strict,
            `Invalid jsonSchema_addField rule for extension ${ext.params.v2Perm ?? "?"}: ${JSON.stringify(value)}`,
            { v2Perm: ext.params.v2Perm ?? "", raw: value },
          );
          continue;
        }
        const application = ext.params.application?.trim();
        if (!application) {
          failPatch(
            strict,
            `Extension ${ext.params.v2Perm ?? "?"} missing application param (required for jsonSchema_addField)`,
            { v2Perm: ext.params.v2Perm ?? "" },
          );
          continue;
        }
        const resource = ext.params.resource?.trim();
        jsonSchemaFields.push({
          ...parsed,
          application,
          ...(resource ? { resource } : {}),
        });
      }
    }
  }

  // Apply public flag retroactively to workspace permissions
  for (const rel of workspaceExtra) {
    if (publicPerms.has(rel.name)) {
      rel.isPublic = true;
    }
  }

  // ── Pass 2: Emit accumulated relations ──

  for (const [key, { rule, refs }] of accumulators) {
    if (refs.length === 0) continue;

    const target = key.split("/")[0];
    let body: RelationBody;

    if (rule.op === "or") {
      body = {
        kind: "or",
        members: refs.map((r) => ({ kind: "ref" as const, name: r })),
      };
    } else if (rule.op === "and") {
      body = {
        kind: "and",
        members: refs.map((r) => ({ kind: "ref" as const, name: r })),
      };
    } else {
      continue;
    }

    const rel: RelationDef = { name: rule.name, body, isPublic: rule.isPublic };

    if (target === "workspace") workspaceExtra.push(rel);
    else if (target === "role") roleExtra.push(rel);
    else if (target === "roleBinding") roleBindingExtra.push(rel);
  }

  // ── Build enriched resources ──

  const result: ResourceDef[] = [];
  for (const res of resources) {
    const merged = { ...res, relations: [...res.relations] };

    if (res.name === "role" && res.namespace === "rbac") {
      merged.relations.push(...roleExtra);
    }
    if (res.name === "role_binding" && res.namespace === "rbac") {
      merged.relations.push(...roleBindingExtra);
    }
    if (res.name === "workspace" && res.namespace === "rbac") {
      merged.relations.push(...workspaceExtra);
    }

    result.push(merged);
  }

  if (!result.some((r) => r.name === "principal" && r.namespace === "rbac")) {
    result.unshift({ name: "principal", namespace: "rbac", relations: [] });
  }

  return { resources: result, jsonSchemaFields };
}
