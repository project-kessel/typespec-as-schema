// Barrel module — re-exports all public API for backward compatibility.

export type {
  RelationDef,
  RelationBody,
  ResourceDef,
  V1Extension,
  UnifiedJsonSchema,
  ServiceMetadata,
  IntermediateRepresentation,
} from "./types.js";

export {
  getNamespaceFQN,
  camelToSnake,
  bodyToZed,
} from "./utils.js";

export { parsePermissionExpr } from "./parser.js";

export {
  findExtensionTemplate,
  isInstanceOf,
  discoverResources,
} from "./discover.js";

export {
  generateSpiceDB,
  generateUnifiedJsonSchemas,
  generateMetadata,
  generateIR,
} from "./generate.js";

export { compile, NodeHost } from "@typespec/compiler";
