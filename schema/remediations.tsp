// Remediations Service Schema
// Permissions-only service: registers permissions on workspace without
// defining any resource types.

import "../lib/main.tsp";

using Kessel;

namespace Remediations;

@v1Permission("remediations", "remediations", "read", "remediations_remediation_view")
@v1Permission("remediations", "remediations", "write", "remediations_remediation_update")
model RemediationsPermissions {}
