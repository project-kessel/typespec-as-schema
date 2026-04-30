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

export interface ResourceDef {
  name: string;
  namespace: string;
  relations: RelationDef[];
}

export interface V1Extension {
  application: string;
  resource: string;
  verb: string;
  v2Perm: string;
}

export interface UnifiedJsonSchema {
  $schema: string;
  $id: string;
  type: string;
  properties: Record<string, { type: string; format?: string; source?: string }>;
  required: string[];
}

export interface ServiceMetadata {
  permissions: string[];
  resources: string[];
}

export interface IntermediateRepresentation {
  version: string;
  generatedAt: string;
  source: string;
  resources: ResourceDef[];
  extensions: V1Extension[];
  spicedb: string;
  metadata: Record<string, ServiceMetadata>;
  jsonSchemas: Record<string, UnifiedJsonSchema>;
  annotations?: Record<string, Record<string, string>>;
}
