// Barrel module — re-exports all public API.
// Also defines the TypeSpec emitter library ($lib) and state keys.

import { createTypeSpecLibrary, paramMessage, type JSONSchemaType } from "@typespec/compiler";

// ─── Emitter library definition ──────────────────────────────────────

export interface KesselEmitterOptions {
  "output-format"?: "spicedb" | "metadata" | "unified-jsonschema";
  strict?: boolean;
}

// AJV's JSONSchemaType is overly strict with optional union properties;
// cast is the standard workaround in TypeSpec emitter libraries.
const optionsSchema = {
  type: "object",
  properties: {
    "output-format": {
      type: "string",
      enum: ["spicedb", "metadata", "unified-jsonschema"],
      nullable: true,
    },
    strict: { type: "boolean", nullable: true },
  },
  required: [],
  additionalProperties: false,
} as JSONSchemaType<KesselEmitterOptions>;

export const $lib = createTypeSpecLibrary({
  name: "typespec-as-schema",
  diagnostics: {
    "invalid-permission-expr": {
      severity: "error",
      messages: {
        default: paramMessage`Invalid permission expression: "${"expr"}"`,
      },
    },
  },
  emitter: { options: optionsSchema },
} as const);

export const StateKeys = {
  kesselExtension: $lib.createStateSymbol("kesselExtension"),
  cascadePolicy: $lib.createStateSymbol("cascadePolicy"),
  annotation: $lib.createStateSymbol("annotation"),
};

// ─── Public API re-exports ───────────────────────────────────────────

export type {
  RelationDef,
  RelationBody,
  ResourceDef,
  UnifiedJsonSchema,
  CascadeDeleteEntry,
  AnnotationEntry,
  ServiceMetadata,
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
  getStringValue,
  extractParams,
} from "./utils.js";

export { ref, subref, or, and, addRelation, hasRelation } from "./primitives.js";

export { discoverResources } from "./discover-resources.js";

export { expandCascadeDeletePolicies, type CascadeExpansionResult } from "./expand-cascade.js";

export {
  generateSpiceDB,
  generateUnifiedJsonSchemas,
  generateMetadata,
} from "./generate.js";

export {
  discoverTemplateInstances,
  type TemplateDef,
  type TemplateDiscoveryResult,
} from "./discover-templates.js";

export {
  defineProvider,
  registerProvider,
  getProviders,
  clearProviders,
  type ProviderConfig,
  type ProviderTemplateConfig,
  type KesselProvider,
  type ProviderDiscoveryResult,
  type ProviderExpansionResult,
  type MetadataContribution,
} from "./provider-registry.js";
