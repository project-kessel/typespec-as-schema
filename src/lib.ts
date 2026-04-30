// Barrel module — re-exports all public API for backward compatibility.

export { IR_VERSION } from "./types.js";
export type {
  KesselVerb,
  RelationDef,
  RelationBody,
  ResourceDef,
  V1Extension,
  UnifiedJsonSchema,
  ServiceMetadata,
  IntermediateRepresentation,
  CascadeDeleteEntry,
  AnnotationEntry,
  RBACScaffold,
} from "./types.js";

export {
  getNamespaceFQN,
  camelToSnake,
  bodyToZed,
  slotName,
  flattenAnnotations,
  findResource,
  cloneResources,
  isAssignable,
} from "./utils.js";

export { parsePermissionExpr } from "./parser.js";

export {
  findExtensionTemplate,
  isInstanceOf,
  discoverResources,
  discoverV1Permissions,
  discoverAnnotations,
  discoverCascadeDeletePolicies,
  VALID_VERBS,
} from "./discover.js";
export type { DiscoveryWarnings, DiscoveryStats } from "./discover.js";

export {
  expandV1Permissions,
  expandCascadeDeletePolicies,
  resolveRBACScaffold,
} from "./expand.js";
export type { ScaffoldResult, ExpansionResult } from "./expand.js";

export {
  generateSpiceDB,
  generateUnifiedJsonSchemas,
  generateMetadata,
  generateIR,
} from "./generate.js";

export { EXTENSION_TEMPLATES, type ExtensionTemplateDef } from "./registry.js";

export { compilePipeline, type PipelineResult, type PipelineOptions } from "./pipeline.js";

export { compile, NodeHost } from "@typespec/compiler";
