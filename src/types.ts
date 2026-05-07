export const IR_VERSION = "1.2.0";

export interface RelationDef {
  name: string;
  body: RelationBody;
}

export type RelationBody =
  | { kind: "assignable"; target: string; cardinality: string }
  | { kind: "bool"; target: string }
  | { kind: "ref"; name: string }
  | { kind: "subref"; name: string; subname: string }
  | { kind: "or"; members: RelationBody[] }
  | { kind: "and"; members: RelationBody[] };

export type DataFieldSchema =
  | { type: "string"; format?: string; maxLength?: number; minLength?: number; pattern?: string; enum?: string[] }
  | { type: "integer"; minimum?: number; maximum?: number }
  | { type: "number"; minimum?: number; maximum?: number }
  | { type: "boolean" }
  | { type: "array"; items?: DataFieldSchema }
  | { type: "object"; properties?: Record<string, DataFieldSchema>; required?: string[] }
  | { oneOf: DataFieldSchema[] };

export interface DataFieldDef {
  name: string;
  required: boolean;
  schema: DataFieldSchema;
}

export interface ResourceDef {
  name: string;
  namespace: string;
  relations: RelationDef[];
  dataFields?: DataFieldDef[];
}

export type JsonSchemaProperty =
  | {
      type: string;
      format?: string;
      maxLength?: number;
      minLength?: number;
      pattern?: string;
      source?: string;
      enum?: (string | number)[];
      minimum?: number;
      maximum?: number;
      items?: JsonSchemaProperty;
      properties?: Record<string, JsonSchemaProperty>;
      required?: string[];
    }
  | { oneOf: JsonSchemaProperty[] };

export interface UnifiedJsonSchema {
  $schema: string;
  $id: string;
  type: string;
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

export interface CascadeDeleteEntry {
  childApplication: string;
  childResource: string;
  parentRelation: string;
}

export interface AnnotationEntry {
  key: string;
  value: string;
}

export interface ServiceMetadata {
  permissions: string[];
  resources: string[];
  cascadeDeletePolicies?: string[];
  annotations?: Record<string, string>;
}

import type { DiscoveredExtension } from "./provider.js";

export interface ProviderDiscoveryResult {
  providerId: string;
  discovered: DiscoveredExtension[];
}

export type ExtensionParams = Record<string, string>;

export interface IntermediateRepresentation {
  version: string;
  generatedAt: string;
  source: string;
  resources: ResourceDef[];
  extensions: Record<string, ExtensionParams[]>;
  spicedb: string;
  metadata: Record<string, ServiceMetadata>;
  jsonSchemas: Record<string, UnifiedJsonSchema>;
  annotations?: Record<string, Record<string, string>>;
}
