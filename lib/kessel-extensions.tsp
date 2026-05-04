// Kessel Platform Extension Library
//
// Provider-neutral extension templates. Domain-specific templates
// (e.g., V1WorkspacePermission) live in their provider packages.

import "./kessel.tsp";

namespace Kessel;

/**
 * Cascade-delete policy between a child and parent resource.
 * Expansion adds a "delete" permission on the child that is gated on
 * the parent's delete permission, enforcing that deleting the parent
 * cascades authorization to the child.
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
