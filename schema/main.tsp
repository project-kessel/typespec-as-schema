// Schema Unification Entrypoint
// Imports all service schemas for unified compilation.
//
// RBAC-specific extensions (V1WorkspacePermission) live in ./rbac/.
// HBI-specific extensions (ExposeHostPermission) live in ./hbi/.
// Annotations and cascade-delete policies are declared via decorators
// directly on resource models (@annotation, @cascadeDelete).

import "./rbac/rbac-extensions.tsp";
import "./rbac/rbac.tsp";
import "./hbi/hbi-extensions.tsp";
import "./hbi/hbi.tsp";
import "./remediations.tsp";
