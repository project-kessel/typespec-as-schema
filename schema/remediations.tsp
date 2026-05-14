// Remediations Service Schema
// Permissions-only service: registers permissions on workspace without
// defining any resource types. Demonstrates a service that only needs
// authorization extensions, not data schemas.

import "../lib/kessel.tsp";
import "../lib/decorators.tsp";
import "./rbac/rbac.tsp";

using Kessel;

namespace Remediations;

@v1Permission("remediations", "remediations", "read", "remediations_remediation_view")
@v1Permission("remediations", "remediations", "write", "remediations_remediation_update")
model RemediationsPermissions {}
