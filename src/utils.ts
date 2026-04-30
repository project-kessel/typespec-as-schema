import type { Namespace } from "@typespec/compiler";
import type { RelationBody, ResourceDef, AnnotationEntry } from "./types.js";

export function getNamespaceFQN(ns: Namespace | undefined): string {
  if (!ns) return "";
  const parts: string[] = [];
  let current: Namespace | undefined = ns;
  while (current && current.name) {
    parts.unshift(current.name);
    current = current.namespace;
  }
  return parts.join(".");
}

export function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

export function bodyToZed(body: RelationBody): string {
  switch (body.kind) {
    case "assignable":
      return `${body.target}`;
    case "bool":
      return `${body.target}:*`;
    case "ref":
      return body.name;
    case "subref":
      return `${body.name}->${body.subname}`;
    case "or":
      return body.members.map(bodyToZed).join(" + ");
    case "and": {
      const inner = body.members.map(bodyToZed).join(" & ");
      return `(${inner})`;
    }
  }
}

export function slotName(relName: string): string {
  return `t_${relName}`;
}

export function flattenAnnotations(
  annotations: Map<string, AnnotationEntry[]>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [resourceKey, entries] of annotations) {
    out[resourceKey] = Object.fromEntries(entries.map(e => [e.key, e.value]));
  }
  return out;
}

export function findResource(
  resources: ResourceDef[],
  ns: string,
  name: string,
): ResourceDef | undefined {
  return resources.find((r) => r.namespace === ns && r.name === name);
}

export function cloneResources(resources: ResourceDef[]): ResourceDef[] {
  return resources.map((r) => ({ ...r, relations: [...r.relations] }));
}

export function isAssignable(body: RelationBody): boolean {
  return body.kind === "assignable" || body.kind === "bool";
}
