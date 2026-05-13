import "../dist/src/tsp-index.js";

namespace Kessel;

/**
 * Marks a model as an extension template owned by a provider.
 * The pipeline reads this metadata to auto-generate discovery
 * and build the template registry.
 *
 * @param id Unique provider identifier (e.g. "rbac").
 * @param ownedNamespace Namespace this provider owns (excluded from JSON schema, etc.).
 * @param costPerInstance Complexity cost per extension instance (default: 1).
 * @param applicationParam Param key used for namespace cross-checking.
 * @param permissionParam Param key used for permission metadata.
 */
extern dec provider(
  target: unknown,
  id: valueof string,
  ownedNamespace?: valueof string,
  costPerInstance?: valueof int32,
  applicationParam?: valueof string,
  permissionParam?: valueof string,
);

/**
 * Attaches a key/value annotation to a resource model.
 * Annotations appear in the IR metadata but do not affect the SpiceDB schema.
 * Application and resource are inferred from the model's namespace and name.
 *
 * @param key Annotation key (e.g. "feature_flag", "retention_days").
 * @param value Annotation value.
 */
extern dec annotation(target: unknown, key: valueof string, value: valueof string);

/**
 * Declares a cascade-delete policy on a resource model.
 * When the parent is deleted, authorization cascades to this child
 * via the named relation.
 *
 * @param parentRelation Relation on this model that points to the parent (e.g. "workspace").
 */
extern dec cascadeDelete(target: unknown, parentRelation: valueof string);
