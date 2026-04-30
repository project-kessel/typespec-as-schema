// Kessel Extension Library
// Extension templates for Zanzibar-style authorization patterns.
// Templates carry parameters only; expansion logic lives in src/expand.ts.

import "./kessel.tsp";

namespace Kessel;

/** Allowed verbs for permission registration. */
alias KesselVerb = "read" | "write" | "create" | "delete";

model V1WorkspacePermission<
  App extends string,
  Res extends string,
  Verb extends KesselVerb,
  V2 extends string
> {
  /** Lowercase application identifier (e.g. "inventory"). */
  application: App;

  /** Lowercase resource identifier (e.g. "hosts"). */
  resource: Res;

  /** The verb this permission covers. */
  verb: Verb;

  /** Snake_case v2 permission name (e.g. "inventory_host_view"). */
  v2Perm: V2;
}

/**
 * Cascade-delete policy between a child and parent resource.
 * Expansion adds a "delete" permission on the child that is gated on
 * the parent's delete permission, enforcing that deleting the parent
 * cascades authorization to the child.
 *
 * This is the second extension template, proving the architecture can
 * support patterns beyond V1WorkspacePermission.
 */
model CascadeDeletePolicy<
  ChildApp extends string,
  ChildResource extends string,
  ParentRelation extends string
> {
  /** Application that owns the child resource. */
  childApplication: ChildApp;

  /** Child resource name. */
  childResource: ChildResource;

  /** Relation on the child that points to the parent (e.g., "workspace"). */
  parentRelation: ParentRelation;
}

/**
 * Non-RBAC metadata attached to a resource.
 * Appears in the IR but does not affect the SpiceDB schema.
 * Use for feature flags, retention policies, or other service-specific metadata.
 */
model ResourceAnnotation<
  Application extends string,
  Resource extends string,
  Key extends string,
  Value extends string
> {
  /** Application that owns this resource. */
  application: Application;

  /** Resource this annotation applies to. */
  resource: Resource;

  /** Annotation key (e.g. "feature_flag", "retention_days"). */
  key: Key;

  /** Annotation value. */
  value: Value;
}
