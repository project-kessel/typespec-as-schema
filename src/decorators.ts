// Kessel Decorator Implementations
//
// JS implementations for the extern dec declarations in lib/decorators.tsp.
// TypeSpec resolves these by matching $-prefixed function names exported
// from the package's JS entry point.

import type { DecoratorContext, Model } from "@typespec/compiler";
import { setTypeSpecNamespace } from "@typespec/compiler";
import { StateKeys } from "./lib.js";

export function $kesselExtension(context: DecoratorContext, target: Model) {
  context.program.stateSet(StateKeys.kesselExtension).add(target);
}

export function $cascadePolicy(context: DecoratorContext, target: Model) {
  context.program.stateSet(StateKeys.cascadePolicy).add(target);
}

export function $annotation(context: DecoratorContext, target: Model) {
  context.program.stateSet(StateKeys.annotation).add(target);
}

setTypeSpecNamespace("Kessel", $kesselExtension, $cascadePolicy, $annotation);
