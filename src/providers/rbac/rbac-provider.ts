// RBAC Extension Logic
//
// Owns the V1WorkspacePermission expansion: the 7 mutations per
// permission, view_metadata accumulation, and cascade-delete scaffold wiring.
//
// This is the TypeSpec equivalent of:
//   - TS-POC:     schema/rbac.ts → create_v1_based_workspace_permission()
//   - Starlark:   schema/rbac.star → v1_based_permission()
//   - CUE:        rbac/rbac.cue → #AddV1BasedPermission

import {
  navigateProgram,
  isTemplateInstance,
  type Program,
  type Model,
  type Namespace,
  type Type,
} from "@typespec/compiler";
import type { ResourceDef } from "../../types.js";
import { ref, subref, or, and, addRelation, hasRelation } from "../../primitives.js";
import { findResource, cloneResources, getNamespaceFQN, getStringValue, extractParams } from "../../utils.js";

// ─── RBAC domain types ──────────────────────────────────────────────

type KesselVerb = "read" | "write" | "create" | "delete";

export interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

export interface ExpansionResult {
  resources: ResourceDef[];
  warnings: string[];
}

interface RBACScaffold {
  role: ResourceDef;
  roleBinding: ResourceDef;
  workspace: ResourceDef;
}

export interface DiscoveryStats {
  aliasesAttempted: number;
  aliasesResolved: number;
  resourcesFound: number;
  extensionsFound: number;
}

export interface DiscoveryWarnings {
  skipped: string[];
  stats: DiscoveryStats;
}

// ─── RBAC constants ─────────────────────────────────────────────────

const RBAC_RELATIONS = {
  subject: "subject",
  granted: "granted",
  binding: "binding",
  parent: "parent",
  globalWildcard: "any_any_any",
} as const;

export const VALID_VERBS = new Set<KesselVerb>(["read", "write", "create", "delete"]);

function isKesselVerb(v: string): v is KesselVerb {
  return VALID_VERBS.has(v as KesselVerb);
}

// ─── V1WorkspacePermission template definition ──────────────────────

export interface TemplateDef {
  templateName: string;
  paramNames: string[];
  namespace: string;
}

const V1_TEMPLATE: TemplateDef = {
  templateName: "V1WorkspacePermission",
  paramNames: ["application", "resource", "verb", "v2Perm"],
  namespace: "Kessel",
};

// ─── AST Walking Utilities ──────────────────────────────────────────

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

export function discoverTemplateInstances(
  program: Program,
  def: TemplateDef,
): { results: Record<string, string>[]; skipped: string[]; aliasesAttempted: number; aliasesResolved: number } {
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

// ─── RBAC scaffold resolution ───────────────────────────────────────

function resolveRBACScaffold(resources: ResourceDef[]): { scaffold: RBACScaffold | null; warnings: string[] } {
  const role = findResource(resources, "rbac", "role");
  const roleBinding = findResource(resources, "rbac", "role_binding");
  const workspace = findResource(resources, "rbac", "workspace");

  if (!role || !roleBinding || !workspace) {
    const missing = [
      !role && "rbac/role",
      !roleBinding && "rbac/role_binding",
      !workspace && "rbac/workspace",
    ].filter(Boolean);
    return {
      scaffold: null,
      warnings: [`RBAC scaffold incomplete — missing ${missing.join(", ")}. V1 permission expansion skipped.`],
    };
  }

  return { scaffold: { role, roleBinding, workspace }, warnings: [] };
}

// ─── RBAC expansion helpers ─────────────────────────────────────────

function addBoolRelation(resource: ResourceDef, name: string, seen: Set<string>): void {
  if (seen.has(name)) return;
  seen.add(name);
  addRelation(resource, { name, body: { kind: "bool", target: "rbac/principal" } });
}

// ─── V1 Permission Expansion ────────────────────────────────────────

export function expandV1Permissions(baseResources: ResourceDef[], permissions: V1Extension[]): ExpansionResult {
  const resources = cloneResources(baseResources);

  if (!resources.some((r) => r.name === "principal" && r.namespace === "rbac")) {
    resources.unshift({ name: "principal", namespace: "rbac", relations: [] });
  }

  const { scaffold, warnings } = resolveRBACScaffold(resources);
  if (!scaffold) return { resources, warnings };

  const { role, roleBinding, workspace } = scaffold;

  const addedBoolRelations = new Set<string>();
  for (const rel of role.relations) {
    if (rel.body.kind === "bool") addedBoolRelations.add(rel.name);
  }

  const viewMetadataRefs: string[] = [];

  for (const perm of permissions) {
    const { application: app, resource: res, verb, v2Perm: v2 } = perm;

    addBoolRelation(role, `${app}_any_any`, addedBoolRelations);
    addBoolRelation(role, `${app}_${res}_any`, addedBoolRelations);
    addBoolRelation(role, `${app}_any_${verb}`, addedBoolRelations);
    addBoolRelation(role, `${app}_${res}_${verb}`, addedBoolRelations);

    addRelation(role, {
      name: v2,
      body: or(
        ref(RBAC_RELATIONS.globalWildcard),
        ref(`${app}_any_any`),
        ref(`${app}_${res}_any`),
        ref(`${app}_any_${verb}`),
        ref(`${app}_${res}_${verb}`),
      ),
    });

    addRelation(roleBinding, {
      name: v2,
      body: and(ref(RBAC_RELATIONS.subject), subref(RBAC_RELATIONS.granted, v2)),
    });

    addRelation(workspace, {
      name: v2,
      body: or(subref(RBAC_RELATIONS.binding, v2), subref(RBAC_RELATIONS.parent, v2)),
    });

    if (verb === "read") {
      viewMetadataRefs.push(v2);
    }
  }

  if (viewMetadataRefs.length > 0) {
    addRelation(workspace, {
      name: "view_metadata",
      body: or(...viewMetadataRefs.map((r) => ref(r))),
    });
  }

  return { resources, warnings };
}

// ─── Cascade-Delete Scaffold Wiring ─────────────────────────────────

export function wireDeleteScaffold(resources: ResourceDef[]): ResourceDef[] {
  const result = cloneResources(resources);
  const { scaffold } = resolveRBACScaffold(result);
  if (!scaffold) return result;

  const { role, roleBinding, workspace } = scaffold;

  if (!hasRelation(role, "delete")) {
    addRelation(role, { name: "delete", body: ref(RBAC_RELATIONS.globalWildcard) });
  }
  if (!hasRelation(roleBinding, "delete")) {
    addRelation(roleBinding, {
      name: "delete",
      body: and(ref(RBAC_RELATIONS.subject), subref(RBAC_RELATIONS.granted, "delete")),
    });
  }
  if (!hasRelation(workspace, "delete")) {
    addRelation(workspace, {
      name: "delete",
      body: or(subref(RBAC_RELATIONS.binding, "delete"), subref(RBAC_RELATIONS.parent, "delete")),
    });
  }
  return result;
}

// ─── V1 Permission Discovery ────────────────────────────────────────

export function discoverV1Permissions(program: Program, warnings?: DiscoveryWarnings): V1Extension[] {
  const { results, skipped, aliasesAttempted, aliasesResolved } = discoverTemplateInstances(
    program,
    V1_TEMPLATE,
  );
  if (warnings) {
    warnings.skipped.push(...skipped);
    warnings.stats.aliasesAttempted += aliasesAttempted;
    warnings.stats.aliasesResolved += aliasesResolved;
  }
  const extensions = results
    .filter((p) => !!(p.application && p.resource && p.verb && p.v2Perm) && isKesselVerb(p.verb))
    .map((p) => ({
      application: p.application,
      resource: p.resource,
      verb: p.verb as KesselVerb,
      v2Perm: p.v2Perm,
    }));
  if (warnings) warnings.stats.extensionsFound += extensions.length;
  return extensions;
}
