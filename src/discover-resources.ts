// Resource Graph Extraction
//
// Walks the compiled TypeSpec program to build ResourceDef[] from Kessel
// type primitives (Assignable, BoolRelation, Permission). Extension template
// instances are excluded so they don't appear as resources.

import {
  navigateProgram,
  isTemplateInstance,
  type Program,
  type Model,
  type Type,
} from "@typespec/compiler";
import type { RelationDef, ResourceDef } from "./types.js";
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

// ─── Resource model conversion ───────────────────────────────────────

function modelToResource(
  model: Model,
  nsPrefix: string
): ResourceDef | null {
  const relations: RelationDef[] = [];
  let hasRelations = false;

  for (const [name, prop] of model.properties) {
    const propType = prop.type;
    if (propType.kind !== "Model") continue;

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
    }
  }

  if (!hasRelations) return null;

  const nsName = nsPrefix.toLowerCase().replace(/\./g, "/");
  return {
    name: camelToSnake(model.name),
    namespace: nsName || getNamespaceFQN(model.namespace)?.toLowerCase() || "unknown",
    relations,
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

      const resource = modelToResource(model, nsPrefix);
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
