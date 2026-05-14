// Kessel Decorator Implementations
//
// JS implementations for the extern dec declarations in lib/decorators.tsp.
// TypeSpec resolves these by matching $-prefixed function names exported
// from the package's JS entry point.

import type { DecoratorContext, Model } from "@typespec/compiler";
import { setTypeSpecNamespace } from "@typespec/compiler";
import { StateKeys } from "./lib.js";
import { camelToSnake } from "./utils.js";

export function $kesselExtension(context: DecoratorContext, target: Model) {
  context.program.stateSet(StateKeys.kesselExtension).add(target);
}

export function $cascadePolicy(context: DecoratorContext, target: Model) {
  context.program.stateSet(StateKeys.cascadePolicy).add(target);
}

export function $annotation(context: DecoratorContext, target: Model) {
  context.program.stateSet(StateKeys.annotation).add(target);
}

export function $v1Permission(
  context: DecoratorContext,
  target: Model,
  app: string,
  resource: string,
  verb: string,
  v2Perm: string,
) {
  const map = context.program.stateMap(StateKeys.v1Permission);
  const existing = (map.get(target) as Array<{ application: string; resource: string; verb: string; v2Perm: string }>) ?? [];
  existing.push({ application: app, resource, verb, v2Perm });
  map.set(target, existing);
}

export function $cascadeDelete(
  context: DecoratorContext,
  target: Model,
  parentRelation: string,
) {
  const ns = target.namespace?.name?.toLowerCase() ?? "";
  const resName = camelToSnake(target.name);
  const map = context.program.stateMap(StateKeys.cascadePolicy);
  const existing = (map.get(target) as Array<{ childApplication: string; childResource: string; parentRelation: string }>) ?? [];
  existing.push({ childApplication: ns, childResource: resName, parentRelation });
  map.set(target, existing);
}

export function $resourceAnnotation(
  context: DecoratorContext,
  target: Model,
  key: string,
  value: string,
) {
  const ns = target.namespace?.name?.toLowerCase() ?? "";
  const resName = camelToSnake(target.name);
  const map = context.program.stateMap(StateKeys.annotation);
  const existing = (map.get(target) as Array<{ application: string; resource: string; key: string; value: string }>) ?? [];
  existing.push({ application: ns, resource: resName, key, value });
  map.set(target, existing);
}

setTypeSpecNamespace(
  "Kessel",
  $kesselExtension,
  $cascadePolicy,
  $annotation,
  $v1Permission,
  $cascadeDelete,
  $resourceAnnotation,
);
