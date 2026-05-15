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
  | {
      type: "string";
      format?: string;
      maxLength?: number;
      minLength?: number;
      pattern?: string;
    }
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
