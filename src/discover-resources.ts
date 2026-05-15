// Resource Graph Extraction
//
// Walks the compiled TypeSpec program to build ResourceDef[] from Kessel
// type primitives (Assignable, BoolRelation, Permission). Extension template
// instances are excluded so they don't appear as resources.

import {
  navigateProgram,
  isTemplateInstance,
  getFormat,
  getMaxLength,
  getMinLength,
  getPattern,
  type Program,
  type Model,
  type ModelProperty,
  type Scalar,
  type Type,
} from "@typespec/compiler";
import type { RelationBody, RelationDef, ResourceDef, DataFieldDef, DataFieldSchema } from "./types.js";
import { getNamespaceFQN, camelToSnake, slotName } from "./utils.js";

// ─── Type helpers ────────────────────────────────────────────────────

function isKesselType(model: Model, expectedName: string): boolean {
  return model.name === expectedName && getNamespaceFQN(model.namespace).endsWith("Kessel");
}

function getTemplateArg(model: Model, index: number): Type | undefined {
  if (!isTemplateInstance(model)) return undefined;
  return model.templateMapper?.args?.[index] as Type | undefined;
}

function hasTypeProperty(t: Type): t is Type & { type: Type } {
  if (!("type" in t)) return false;
  const val = (t as unknown as Record<string, unknown>)["type"];
  return typeof val === "object" && val !== null;
}

function getEnumMemberName(t: Type | undefined): string | undefined {
  if (!t) return undefined;
  if (t.kind === "EnumMember") return t.name;
  if (hasTypeProperty(t) && t.type.kind === "EnumMember") {
    return t.type.name;
  }
  return undefined;
}

function resolveTargetName(t: Type | undefined): string {
  if (!t) return "unknown";
  if (t.kind === "Model") {
    const ns = getNamespaceFQN(t.namespace)?.toLowerCase() || "";
    return ns ? `${ns}/${camelToSnake(t.name)}` : camelToSnake(t.name);
  }
  return "unknown";
}

// ─── Permission expression type walker ───────────────────────────────

function extractStringLiteral(model: Model, propName: string): string | undefined {
  const prop = model.properties.get(propName);
  if (!prop) return undefined;
  const t = prop.type;
  if (t.kind === "Scalar" && t.name) return t.name;
  if ("value" in t) return String((t as unknown as Record<string, unknown>).value);
  return undefined;
}

function modelToRelationBody(model: Model): RelationBody | null {
  if (isKesselType(model, "Ref")) {
    const name = extractStringLiteral(model, "__name");
    if (!name) return null;
    return { kind: "ref", name };
  }

  if (isKesselType(model, "SubRef")) {
    const relation = extractStringLiteral(model, "__relation");
    const sub = extractStringLiteral(model, "__sub");
    if (!relation || !sub) return null;
    return { kind: "subref", name: slotName(relation), subname: sub };
  }

  if (isKesselType(model, "Or")) {
    const leftProp = model.properties.get("__left");
    const rightProp = model.properties.get("__right");
    if (!leftProp || !rightProp) return null;
    if (leftProp.type.kind !== "Model" || rightProp.type.kind !== "Model") return null;
    const left = modelToRelationBody(leftProp.type as Model);
    const right = modelToRelationBody(rightProp.type as Model);
    if (!left || !right) return null;
    const leftMembers = left.kind === "or" ? left.members : [left];
    const rightMembers = right.kind === "or" ? right.members : [right];
    return { kind: "or", members: [...leftMembers, ...rightMembers] };
  }

  if (isKesselType(model, "And")) {
    const leftProp = model.properties.get("__left");
    const rightProp = model.properties.get("__right");
    if (!leftProp || !rightProp) return null;
    if (leftProp.type.kind !== "Model" || rightProp.type.kind !== "Model") return null;
    const left = modelToRelationBody(leftProp.type as Model);
    const right = modelToRelationBody(rightProp.type as Model);
    if (!left || !right) return null;
    const leftMembers = left.kind === "and" ? left.members : [left];
    const rightMembers = right.kind === "and" ? right.members : [right];
    return { kind: "and", members: [...leftMembers, ...rightMembers] };
  }

  return null;
}

// ─── Data field extraction ────────────────────────────────────────────

function resolveBaseScalar(scalar: Scalar): Scalar {
  let base = scalar;
  while (base.baseScalar) base = base.baseScalar;
  return base;
}

function scalarToSchema(
  program: Program,
  scalar: Scalar,
  prop: ModelProperty | null,
): DataFieldSchema | null {
  const base = resolveBaseScalar(scalar);
  if (base.name !== "string") return null;

  const schema: DataFieldSchema & { type: "string" } = { type: "string" };
  const format = getFormat(program, scalar) ?? (prop ? getFormat(program, prop) : undefined);
  if (format) schema.format = format;
  const maxLen = getMaxLength(program, scalar) ?? (prop ? getMaxLength(program, prop) : undefined);
  if (maxLen !== undefined) schema.maxLength = maxLen;
  const minLen = getMinLength(program, scalar) ?? (prop ? getMinLength(program, prop) : undefined);
  if (minLen !== undefined) schema.minLength = minLen;
  const pattern = getPattern(program, scalar) ?? (prop ? getPattern(program, prop) : undefined);
  if (pattern) schema.pattern = pattern;
  return schema;
}

function extractDataField(
  program: Program,
  name: string,
  prop: ModelProperty,
): DataFieldDef | null {
  const propType = prop.type;

  if (propType.kind === "Scalar") {
    const schema = scalarToSchema(program, propType, prop);
    if (!schema) return null;
    return { name, required: !prop.optional, schema };
  }

  if (propType.kind === "Union") {
    const variants: DataFieldSchema[] = [];
    for (const [, variant] of propType.variants) {
      if (variant.type.kind === "Scalar") {
        const schema = scalarToSchema(program, variant.type as Scalar, null);
        if (schema) variants.push(schema);
      }
    }
    if (variants.length === 0) return null;
    if (variants.length === 1) {
      return { name, required: !prop.optional, schema: variants[0] };
    }
    return { name, required: !prop.optional, schema: { oneOf: variants } };
  }

  return null;
}

// ─── Resource model conversion ───────────────────────────────────────

function modelToResource(
  program: Program,
  model: Model,
  nsPrefix: string,
): ResourceDef | null {
  const relations: RelationDef[] = [];
  const dataFields: DataFieldDef[] = [];
  let hasRelations = false;

  for (const [name, prop] of model.properties) {
    const propType = prop.type;
    if (propType.kind !== "Model") {
      const field = extractDataField(program, name, prop);
      if (field) dataFields.push(field);
      continue;
    }

    if (isKesselType(propType, "Assignable")) {
      hasRelations = true;
      const targetArg = getTemplateArg(propType, 0);
      const cardArg = getTemplateArg(propType, 1);
      const target = resolveTargetName(targetArg);
      const cardinality = getEnumMemberName(cardArg) ?? "Any";
      relations.push({
        name,
        body: { kind: "assignable", target, cardinality },
      });
    } else if (isKesselType(propType, "BoolRelation")) {
      hasRelations = true;
      const targetArg = getTemplateArg(propType, 0);
      const target = resolveTargetName(targetArg);
      relations.push({
        name,
        body: { kind: "bool", target },
      });
    } else if (isKesselType(propType, "Permission")) {
      hasRelations = true;
      const exprProp = propType.properties.get("__expr");
      if (exprProp && exprProp.type.kind === "Model") {
        const body = modelToRelationBody(exprProp.type as Model);
        if (body) {
          relations.push({ name, body });
        }
      }
    }
  }

  if (!hasRelations) return null;

  const nsName = nsPrefix.toLowerCase().replace(/\./g, "/");
  return {
    name: camelToSnake(model.name),
    namespace: nsName || getNamespaceFQN(model.namespace)?.toLowerCase() || "unknown",
    relations,
    ...(dataFields.length > 0 ? { dataFields } : {}),
  };
}

/**
 * Discovers resource models from the compiled program.
 * Extension template instances (V1WorkspacePermission, CascadeDeletePolicy, etc.)
 * are naturally excluded because modelToResource only picks up models with
 * Assignable, BoolRelation, or Permission properties.
 */
export function discoverResources(
  program: Program,
): { resources: ResourceDef[] } {
  const resources: ResourceDef[] = [];
  const seenResources = new Set<string>();

  navigateProgram(program, {
    model(model: Model) {
      if (model.templateNode && !isTemplateInstance(model)) return;

      const modelNsFQN = getNamespaceFQN(model.namespace);
      if (modelNsFQN.endsWith("Kessel")) return;

      if (!model.name || model.name === "") return;

      const nsPrefix = modelNsFQN;
      const key = `${nsPrefix}/${model.name}`;
      if (seenResources.has(key)) return;

      const resource = modelToResource(program, model, nsPrefix);
      if (resource) {
        seenResources.add(key);
        resources.push(resource);
      }
    },
  });

  resources.sort((a, b) => {
    const ns = a.namespace.localeCompare(b.namespace);
    return ns !== 0 ? ns : a.name.localeCompare(b.name);
  });

  return { resources };
}
