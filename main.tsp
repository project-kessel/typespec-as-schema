// Schema Unification Entrypoint
// Imports all service schemas for unified compilation.
// A custom emitter would walk the full type graph to produce:
//   1. SpiceDB/Zed schema (from relation types)
//   2. JSONSchema (from data models, via built-in emitter)
//   3. Intermediate representation (for Kessel Inventory API)

import "./schemas/rbac.tsp";
import "./schemas/hbi.tsp";
