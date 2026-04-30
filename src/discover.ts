import {
  navigateProgram,
  isTemplateInstance,
  type Program,
  type Model,
  type Namespace,
  type Type,
} from "@typespec/compiler";
import type { RelationDef, ResourceDef } from "./types.js";
import { getNamespaceFQN, camelToSnake } from "./utils.js";
import { parsePermissionExpr } from "./parser.js";

// ─── Type helpers ────────────────────────────────────────────────────

function isKesselType(model: Model, expectedName: string): boolean {
  return model.name === expectedName && getNamespaceFQN(model.namespace).endsWith("Kessel");
}

function getTemplateArg(model: Model, index: number): Type | undefined {
  if (!isTemplateInstance(model)) return undefined;
  return model.templateMapper?.args?.[index] as Type | undefined;
}

function getEnumMemberName(t: Type | undefined): string | undefined {
  if (!t) return undefined;
  if (t.kind === "EnumMember") return t.name;
  if (hasTypeProperty(t) && t.type.kind === "EnumMember") {
    return t.type.name;
  }
  return undefined;
}

function hasTypeProperty(t: Type): t is Type & { type: Type } {
  return "type" in t && typeof (t as unknown as Record<string, unknown>)["type"] === "object" && (t as unknown as Record<string, unknown>)["type"] !== null;
}

function resolveTargetName(t: Type | undefined): string {
  if (!t) return "unknown";
  if (t.kind === "Model") {
    const ns = getNamespaceFQN(t.namespace)?.toLowerCase() || "";
    return ns ? `${ns}/${camelToSnake(t.name)}` : camelToSnake(t.name);
  }
  return "unknown";
}

// ─── Extension template lookup ───────────────────────────────────────

/** Find an extension template by name in the Kessel namespace. */
export function findExtensionTemplate(program: Program, templateName: string): Model | null {
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

// ─── Resource discovery ─────────────────────────────────────────────

const EXTENSION_TEMPLATE_NAMES = ["V1WorkspacePermission", "ResourceAnnotation", "CascadeDeletePolicy"];

function modelToResource(
  model: Model,
  nsPrefix: string
): ResourceDef | null {
  const relations: RelationDef[] = [];
  let hasRelations = false;

  for (const [name, prop] of model.properties) {
    if (name === "data") continue;

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
 * Discovers service resource models (not extension template instances).
 * Extension instances are discovered separately in expand.ts.
 */
export function discoverResources(program: Program): {
  resources: ResourceDef[];
} {
  const resources: ResourceDef[] = [];
  const seenResources = new Set<string>();

  const extensionTemplates = EXTENSION_TEMPLATE_NAMES
    .map((name) => findExtensionTemplate(program, name))
    .filter((m): m is Model => m !== null);

  navigateProgram(program, {
    model(model: Model) {
      if (model.templateNode && !isTemplateInstance(model)) return;

      const modelNsFQN = getNamespaceFQN(model.namespace);
      if (modelNsFQN.endsWith("Kessel")) return;

      if (extensionTemplates.some((t) => isInstanceOf(model, t))) {
        return;
      }

      if (model.name.endsWith("Data")) return;
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

  return { resources };
}
