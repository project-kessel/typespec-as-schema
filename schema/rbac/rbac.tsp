// RBAC Service Schema
//
// Defines core RBAC resource types: Principal, Role, RoleBinding, Workspace.
// This is a service provider schema — RBAC owns these types and the
// expansion logic that wires V1 permissions through them.
//
// Other services import this file to reference RBAC types (e.g., Workspace
// in assignable relations).

import "../../lib/kessel.tsp";

using Kessel;

namespace RBAC;

// ─── Internal Resource Types ─────────────────────────────────────────

/** An authenticated user or service account */
model Principal {}

/** A role defines a named collection of permissions */
model Role {
  /** Wildcard — can hold all principals (principal:*) */
  any_any_any: BoolRelation<Principal>;
}

/** Binds a subject to one or more roles */
model RoleBinding {
  /** The principal(s) this binding applies to */
  subject: Assignable<Principal, Cardinality.Any>;

  /** The role(s) granted */
  granted: Assignable<Role, Cardinality.AtLeastOne>;
}

// ─── Public Resource Types ───────────────────────────────────────────

/** Workspace is the primary RBAC container; permissions inherit via parent */
model Workspace {
  /** Optional parent workspace for permission inheritance */
  parent: Assignable<Workspace, Cardinality.AtMostOne>;

  /** Role bindings granting access to this workspace */
  binding: Assignable<RoleBinding, Cardinality.Any>;
}
