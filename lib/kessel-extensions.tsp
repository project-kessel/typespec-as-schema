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
