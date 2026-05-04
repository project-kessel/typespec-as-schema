// Schema Unification Entrypoint
// Imports all service schemas for unified compilation.
//
// Platform extensions (CascadeDeletePolicy, ResourceAnnotation) live in
// ../lib/kessel-extensions.tsp. RBAC-specific extensions (V1WorkspacePermission)
// live in ../providers/rbac/ — RBAC owns its extension templates and logic.

import "../lib/kessel-extensions.tsp";
import "../providers/rbac/rbac-extensions.tsp";
import "../providers/rbac/rbac.tsp";
import "./hbi.tsp";
import "./remediations.tsp";
