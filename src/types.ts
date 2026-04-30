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

export interface ResourceDef {
  name: string;
  namespace: string;
  relations: RelationDef[];
}

export type KesselVerb = "read" | "write" | "create" | "delete";

export interface V1Extension {
  application: string;
  resource: string;
  verb: KesselVerb;
  v2Perm: string;
}

export interface UnifiedJsonSchema {
  $schema: string;
  $id: string;
  type: string;
  properties: Record<string, { type: string; format?: string; source?: string }>;
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

export interface RBACScaffold {
  role: ResourceDef;
  roleBinding: ResourceDef;
  workspace: ResourceDef;
}

export interface ServiceMetadata {
  permissions: string[];
  resources: string[];
  cascadeDeletePolicies?: string[];
  annotations?: Record<string, string>;
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
