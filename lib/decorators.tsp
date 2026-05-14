// Kessel Custom Decorators
//
// Decorator declarations for the Kessel emitter plugin.
// JS implementations live in src/decorators.ts — the compiler resolves
// them via the package exports and $-prefixed function names.

import "./kessel.tsp";

using TypeSpec.Reflection;

namespace Kessel;

/**
 * Marks a model as a Kessel extension instance for emitter discovery.
 * Apply to `model ... is V1WorkspacePermission<...>` declarations so
 * the emitter can reliably find them via compiler state sets.
 */
extern dec kesselExtension(target: Model);

/**
 * Marks a model as a cascade-delete policy for emitter discovery.
 * Apply to `model ... is CascadeDeletePolicy<...>` declarations.
 */
extern dec cascadePolicy(target: Model);

/**
 * Marks a model as a resource annotation for emitter discovery.
 * Apply to `model ... is ResourceAnnotation<...>` declarations.
 */
extern dec annotation(target: Model);
