// Kessel Schema Library — single-import facade
//
// Service providers import this one file instead of individual lib modules.
//
//   import "../lib/main.tsp";
//
// This brings in all Kessel types, decorators, and RBAC types.

import "./kessel.tsp";
import "./decorators.tsp";
import "./kessel-extensions.tsp";
import "../schema/rbac/rbac.tsp";
import "./aliases.tsp";
