// Barrel module — re-exports all public API.

export { IR_VERSION } from "./types.js";
export type {
  RelationDef,
  RelationBody,
  ResourceDef,
  UnifiedJsonSchema,
  ServiceMetadata,
  IntermediateRepresentation,
  ExtensionParams,
  CascadeDeleteEntry,
  AnnotationEntry,
  ProviderDiscoveryResult,
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

export { ref, subref, or, and, addRelation, hasRelation } from "./primitives.js";

export {
  findExtensionTemplate,
  isInstanceOf,
  discoverExtensionInstances,
} from "./discover-extensions.js";

export {
  discoverAnnotations,
  discoverCascadeDeletePolicies,
} from "./discover-platform.js";
export type { DiscoveryWarnings, DiscoveryStats } from "./discover-platform.js";

export { discoverResources } from "./discover-resources.js";

export { expandCascadeDeletePolicies, type CascadeExpansionResult } from "./expand-cascade.js";

export {
  generateSpiceDB,
  generateUnifiedJsonSchemas,
  generateMetadata,
  generateIR,
} from "./generate.js";

export { PLATFORM_TEMPLATES, buildRegistry, type ExtensionTemplateDef, type RegistryResult } from "./registry.js";

export type { ExtensionProvider, DiscoveredExtension, ProviderExpansionResult } from "./provider.js";

export { compilePipeline, type PipelineResult, type PipelineOptions } from "./pipeline.js";

export { compile, NodeHost } from "@typespec/compiler";
