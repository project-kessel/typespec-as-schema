// Declarative Extension Applicator (Option A)
//
// Reads structured patch declarations from V1WorkspacePermission template
// instances and applies them generically to ResourceDef[], replacing the
// hardcoded buildSchemaFromTypeGraph().
//
// The patch rules live in TypeSpec (owned by the RBAC team) via the
// kessel-extensions.tsp library. This emitter code is extension-agnostic.

import type { Program, Model, Type, Namespace } from "@typespec/compiler";
import { isTemplateInstance } from "@typespec/compiler";
import type { ResourceDef, RelationDef, RelationBody } from "./lib.js";
import { getNamespaceFQN, parsePermissionExpr } from "./lib.js";

// ─── Declarative Extension Instance ──────────────────────────────────

export interface DeclaredExtension {
  params: Record<string, string>;
  patchRules: PatchRule[];
}

export interface PatchRule {
  target: string;       // "role" | "roleBinding" | "workspace"
  patchType: string;    // "boolRelations" | "permission" | "public" | "viewMetadataAccumulator"
  rawValue: string;     // template with {app}, {res}, {verb}, {v2} placeholders
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
const PATCH_TARGETS = ["role", "roleBinding", "workspace"] as const;

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

// ─── Application ─────────────────────────────────────────────────────

export function applyDeclaredPatches(
  resources: ResourceDef[],
  extensions: DeclaredExtension[],
): ResourceDef[] {
  const roleExtra: RelationDef[] = [];
  const roleBindingExtra: RelationDef[] = [];
  const workspaceExtra: RelationDef[] = [];
  const publicPerms = new Set<string>();
  const viewMetadataMembers: string[] = [];
  const addedBoolPerms = new Set<string>();

  for (const ext of extensions) {
    for (const rule of ext.patchRules) {
      const value = interpolate(rule.rawValue, ext.params);

      if (rule.target === "role" && rule.patchType === "boolRelations") {
        for (const rel of parseBoolRelations(value)) {
          if (!addedBoolPerms.has(rel.name)) {
            addedBoolPerms.add(rel.name);
            roleExtra.push(rel);
          }
        }
      } else if (rule.target === "role" && rule.patchType === "permission") {
        const rel = parsePermissionRule(value);
        if (rel) roleExtra.push(rel);
      } else if (rule.target === "roleBinding" && rule.patchType === "permission") {
        const rel = parsePermissionRule(value);
        if (rel) roleBindingExtra.push(rel);
      } else if (rule.target === "workspace" && rule.patchType === "permission") {
        const rel = parsePermissionRule(value);
        if (rel) {
          rel.isPublic = publicPerms.has(rel.name);
          workspaceExtra.push(rel);
        }
      } else if (rule.target === "workspace" && rule.patchType === "public") {
        const permName = interpolate(rule.rawValue, ext.params);
        publicPerms.add(permName);
      } else if (rule.target === "workspace" && rule.patchType === "viewMetadataAccumulator") {
        if (ext.params.verb === value) {
          viewMetadataMembers.push(ext.params.v2Perm);
        }
      }
    }
  }

  // Apply public flag retroactively
  for (const rel of workspaceExtra) {
    if (publicPerms.has(rel.name)) {
      rel.isPublic = true;
    }
  }

  if (viewMetadataMembers.length > 0) {
    workspaceExtra.push({
      name: "view_metadata",
      body: {
        kind: "or",
        members: viewMetadataMembers.map((m) => ({ kind: "ref" as const, name: m })),
      },
      isPublic: true,
    });
  }

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

  return result;
}
