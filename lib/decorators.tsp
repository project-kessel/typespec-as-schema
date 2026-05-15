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

/**
 * Cascade-delete policy: when the parent resource is deleted,
 * authorization cascades to this child resource.
 * Application and resource are inferred from the model's namespace and name.
 *
 * @param parentRelation Relation on this resource pointing to the parent (e.g. "workspace").
 */
extern dec cascadeDelete(target: Model, parentRelation: valueof string);

/**
 * Attaches non-RBAC metadata to a resource (feature flags, retention, etc.).
 * Application and resource are inferred from the model's namespace and name.
 * Appears in metadata output only; does not affect SpiceDB schema.
 *
 * @param key   Annotation key (e.g. "feature_flag", "retention_days").
 * @param value Annotation value.
 */
extern dec resourceAnnotation(target: Model, key: valueof string, value: valueof string);
