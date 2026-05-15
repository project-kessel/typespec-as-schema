// Remediations Service Schema
// Permissions-only service: registers permissions on workspace without
// defining any resource types.

import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;

namespace Remediations;

alias remediationViewPermission = RBAC.V1WorkspacePermission<"remediations", "remediations", "read", "remediations_remediation_view">;
alias remediationUpdatePermission = RBAC.V1WorkspacePermission<"remediations", "remediations", "write", "remediations_remediation_update">;
