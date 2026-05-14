// Pre-composed type aliases for common patterns.
// Reduces boilerplate in service provider schema files.

import "./kessel.tsp";
import "../schema/rbac/rbac.tsp";

using Kessel;

namespace Kessel;

/** Workspace assignment with ExactlyOne cardinality — the common case for service resources. */
alias WorkspaceRef = Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
