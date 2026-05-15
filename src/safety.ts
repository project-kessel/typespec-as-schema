// Schema Validation
//
// Validates that permission expressions resolve to known relations,
// both before and after provider expansion.

import type { ResourceDef } from "./types.js";
import { slotName } from "./utils.js";

// ─── Pre-expansion permission expression validation ─────────────────

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
