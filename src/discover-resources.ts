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
  getMaxValue,
  getMinValue,
  getPattern,
  type Program,
  type Enum,
  type Model,
  type ModelProperty,
  type Scalar,
  type Type,
} from "@typespec/compiler";
import type { RelationDef, ResourceDef, DataFieldDef, DataFieldSchema } from "./types.js";
import type { ExtensionTemplateDef } from "./registry.js";
import { getNamespaceFQN, camelToSnake } from "./utils.js";
import { parsePermissionExpr } from "./parser.js";
import { findExtensionTemplate, isInstanceOf } from "./discover-extensions.js";
import { PLATFORM_TEMPLATES } from "./registry.js";

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

// ─── Data field extraction ───────────────────────────────────────────

type ScalarMapping = { jsonType: string; constraints?: "string" | "numeric" };

const SCALAR_MAP: Record<string, ScalarMapping> = {
  string:         { jsonType: "string",  constraints: "string" },
  int32:          { jsonType: "integer", constraints: "numeric" },
  int64:          { jsonType: "integer", constraints: "numeric" },
  integer:        { jsonType: "integer", constraints: "numeric" },
  boolean:        { jsonType: "boolean" },
  float32:        { jsonType: "number",  constraints: "numeric" },
  float64:        { jsonType: "number",  constraints: "numeric" },
  numeric:        { jsonType: "number",  constraints: "numeric" },
  decimal:        { jsonType: "number",  constraints: "numeric" },
  utcDateTime:    { jsonType: "string",  constraints: "string" },
  offsetDateTime: { jsonType: "string",  constraints: "string" },
  plainDate:      { jsonType: "string",  constraints: "string" },
  plainTime:      { jsonType: "string",  constraints: "string" },
};

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
  const mapping = SCALAR_MAP[base.name];

  if (!mapping) {
    console.error(`Warning: unrecognized scalar type "${base.name}"; skipping data field extraction`);
    return null;
  }

  const schema: Record<string, unknown> = { type: mapping.jsonType };

  if (mapping.constraints === "string") {
    const format = getFormat(program, scalar) ?? (prop ? getFormat(program, prop) : undefined);
    if (format) schema.format = format;
    const maxLen = getMaxLength(program, scalar) ?? (prop ? getMaxLength(program, prop) : undefined);
    if (maxLen !== undefined) schema.maxLength = maxLen;
    const minLen = getMinLength(program, scalar) ?? (prop ? getMinLength(program, prop) : undefined);
    if (minLen !== undefined) schema.minLength = minLen;
    const pat = getPattern(program, scalar) ?? (prop ? getPattern(program, prop) : undefined);
    if (pat) schema.pattern = pat;
  } else if (mapping.constraints === "numeric") {
    const min = getMinValue(program, scalar) ?? (prop ? getMinValue(program, prop) : undefined);
    if (min !== undefined) schema.minimum = min;
    const max = getMaxValue(program, scalar) ?? (prop ? getMaxValue(program, prop) : undefined);
    if (max !== undefined) schema.maximum = max;
  }

  return schema as DataFieldSchema;
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
        const s = scalarToSchema(program, variant.type as Scalar, null);
        if (s) variants.push(s);
      }
    }
    if (variants.length === 0) return null;
    if (variants.length === 1) return { name, required: !prop.optional, schema: variants[0] };
    return { name, required: !prop.optional, schema: { oneOf: variants } };
  }

  if (propType.kind === "Enum") {
    return enumToDataField(name, prop, propType);
  }

  if (propType.kind !== "Intrinsic") {
    console.error(`Warning: unsupported type kind "${propType.kind}" for data field "${name}"; skipping`);
  }
  return null;
}

function enumValues(enumType: Enum): string[] {
  return [...enumType.members.values()].map(m =>
    m.value !== undefined ? String(m.value) : m.name,
  );
}

function enumToDataField(name: string, prop: ModelProperty, enumType: Enum): DataFieldDef {
  return { name, required: !prop.optional, schema: { type: "string", enum: enumValues(enumType) } };
}

function typeToSchema(program: Program, type: Type): DataFieldSchema | null {
  if (type.kind === "Scalar") return scalarToSchema(program, type, null);
  if (type.kind === "Enum") {
    return { type: "string", enum: enumValues(type) };
  }
  if (type.kind === "Model") return modelToSchema(program, type);
  console.error(`Warning: unsupported type kind "${type.kind}" in nested schema; skipping`);
  return null;
}

function modelToSchema(program: Program, model: Model): DataFieldSchema | null {
  if (model.indexer) {
    const itemSchema = typeToSchema(program, model.indexer.value);
    return itemSchema ? { type: "array", items: itemSchema } : { type: "array" };
  }
  const properties: Record<string, DataFieldSchema> = {};
  const required: string[] = [];
  for (const [pName, pProp] of model.properties) {
    const s = typeToSchema(program, pProp.type);
    if (s) {
      properties[pName] = s;
      if (!pProp.optional) required.push(pName);
    }
  }
  if (Object.keys(properties).length === 0) return null;
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

function extractModelDataField(
  program: Program,
  name: string,
  prop: ModelProperty,
  model: Model,
): DataFieldDef | null {
  const schema = modelToSchema(program, model);
  if (!schema) return null;
  return { name, required: !prop.optional, schema };
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
      let expr = "";
      if (exprProp) {
        const exprType = exprProp.type;
        if (exprType.kind === "Scalar" && exprType.name) {
          expr = exprType.name;
        } else if ("value" in exprType) {
          expr = String((exprType as unknown as Record<string, unknown>).value);
        }
      }
      const parsed = parsePermissionExpr(expr);
      if (parsed) {
        relations.push({ name, body: parsed });
      }
    } else {
      const field = extractModelDataField(program, name, prop, propType);
      if (field) dataFields.push(field);
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
 * Accepts the full list of extension templates (platform + providers) so
 * extension template instances are excluded from resource discovery.
 */
export function discoverResources(
  program: Program,
  allTemplates?: ExtensionTemplateDef[],
): { resources: ResourceDef[] } {
  const templates = allTemplates ?? [...PLATFORM_TEMPLATES];
  const resources: ResourceDef[] = [];
  const seenResources = new Set<string>();

  const extensionTemplates = templates
    .map((def) => findExtensionTemplate(program, def.templateName, def.namespace))
    .filter((m): m is Model => m !== null);

  navigateProgram(program, {
    model(model: Model) {
      if (model.templateNode && !isTemplateInstance(model)) return;

      const modelNsFQN = getNamespaceFQN(model.namespace);
      if (modelNsFQN.endsWith("Kessel")) return;

      if (extensionTemplates.some((t) => isInstanceOf(model, t))) {
        return;
      }

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
