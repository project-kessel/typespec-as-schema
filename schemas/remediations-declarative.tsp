// Remediations Service Schema — Declarative Extensions
// Uses Kessel.V1WorkspacePermission from lib/kessel-extensions.tsp.

import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "./rbac.tsp";

using Kessel;

namespace RemediationsDecl;

alias remediationViewPermission = Kessel.V1WorkspacePermission<
  "remediations",
  "remediations",
  "read",
  "remediations_remediation_view"
>;

alias remediationUpdatePermission = Kessel.V1WorkspacePermission<
  "remediations",
  "remediations",
  "write",
  "remediations_remediation_update"
>;
