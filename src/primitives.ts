// Platform Primitives for Extension Providers
//
// Generic graph-building helpers that providers use to construct RelationBody
// AST nodes during expansion. This is the TypeSpec equivalent of the platform
// builtins in the other POCs (TS-POC's add_relation, Starlark's add_member).
//
// Providers import these rather than duplicating low-level IR construction.

import type { ResourceDef, RelationDef, RelationBody } from "./types.js";
import { slotName } from "./utils.js";

export function ref(name: string): RelationBody {
  return { kind: "ref", name };
}

export function subref(name: string, subname: string): RelationBody {
  return { kind: "subref", name: slotName(name), subname };
}

export function or(...members: RelationBody[]): RelationBody {
  return { kind: "or", members };
}

export function and(...members: RelationBody[]): RelationBody {
  return { kind: "and", members };
}

export function addRelation(resource: ResourceDef, rel: RelationDef): void {
  resource.relations.push(rel);
}

export function hasRelation(resource: ResourceDef, name: string): boolean {
  return resource.relations.some((r) => r.name === name);
}
