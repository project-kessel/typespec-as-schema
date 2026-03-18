// RBAC Service Schema
// Defines core RBAC resource types and the workspace permission extension pattern.
// This is an internal/platform service that other services extend.

import "../lib/kessel.tsp";

using Kessel;

namespace RBAC;

// ─── Internal Resource Types ─────────────────────────────────────────

/** An authenticated user or service account */
model Principal {}

/** A role defines a named collection of permissions */
model Role {
  /** Wildcard — can hold all principals (principal:*) */
  all_all_all: BoolRelation<Principal>;
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
  user_grant: Assignable<RoleBinding, Cardinality.Any>;
}

// ─── Extension Template ──────────────────────────────────────────────
// The v1-based workspace permission pattern.
// In a real implementation, a custom emitter would expand this template
// to add relations to Role, RoleBinding, and Workspace.
//
// Template semantics (what the custom emitter would produce):
//   On Role:
//     {app}_all_all: bool                     (if not exists)
//     {app}_{resource}_all: bool              (if not exists)
//     {app}_all_{verb}: bool                  (if not exists)
//     {app}_{resource}_{verb}: bool           (if not exists)
//     {v2Perm}: or(all_all_all, {app}_all_all, {app}_{resource}_all, {app}_all_{verb}, {app}_{resource}_{verb})
//   On RoleBinding:
//     {v2Perm}: and(subject, granted.{v2Perm})
//   On Workspace:
//     {v2Perm}: or(user_grant.{v2Perm}, parent.{v2Perm})
//
// This is modeled as a parameterized model so the emitter can discover it.

model V1BasedPermission<
  Application extends string,
  Resource extends string,
  Verb extends string,
  V2Perm extends string
> {
  application: Application;
  resource: Resource;
  verb: Verb;
  v2Perm: V2Perm;
}
