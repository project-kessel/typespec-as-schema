// RBAC Extension Templates
//
// Service-provider-owned extension templates for Zanzibar-style authorization.
// RBAC owns these templates and the expansion logic in rbac-provider.ts.
// Templates carry parameters only; expansion is in rbac-provider.ts.
//
// This mirrors how TS-POC's rbac.ts exports create_v1_based_workspace_permission
// and Starlark's rbac.star exports v1_based_permission.

import "../../lib/kessel.tsp";

using Kessel;
using TypeSpec.Reflection;

namespace RBAC;

/** Allowed verbs for permission registration. */
alias KesselVerb = "read" | "write" | "create" | "delete";

/**
 * Registers a V1 workspace permission on a resource model.
 * Alternative to the template alias `RBAC.V1WorkspacePermission<...>`.
 */
extern dec v1Permission(
  target: Model,
  verb: valueof KesselVerb,
  resource: valueof string,
  application: valueof string,
  v2Perm: valueof string,
);

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
