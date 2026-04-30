import * as path from "path";
import {
  IR_VERSION,
  type ResourceDef,
  type V1Extension,
  type UnifiedJsonSchema,
  type ServiceMetadata,
  type IntermediateRepresentation,
  type CascadeDeleteEntry,
  type AnnotationEntry,
} from "./types.js";
import { bodyToZed, slotName, flattenAnnotations, isAssignable } from "./utils.js";

export function generateSpiceDB(resources: ResourceDef[]): string {
  const lines: string[] = [];

  for (const res of resources) {
    lines.push(`definition ${res.namespace}/${res.name} {`);

    const assignables = res.relations.filter((r) => isAssignable(r.body));
    const computed = res.relations.filter((r) => !isAssignable(r.body));

    const permLines: string[] = [];
    const relLines: string[] = [];

    for (const rel of assignables) {
      const tName = slotName(rel.name);
      relLines.push(`    relation ${tName}: ${bodyToZed(rel.body)}`);
      permLines.push(`    permission ${rel.name} = ${tName}`);
    }

    for (const perm of computed) {
      permLines.push(`    permission ${perm.name} = ${bodyToZed(perm.body)}`);
    }

    for (const p of permLines) lines.push(p);
    if (permLines.length > 0 && relLines.length > 0) lines.push("");
    for (const r of relLines) lines.push(r);

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

export function generateUnifiedJsonSchemas(
  resources: ResourceDef[],
): Record<string, UnifiedJsonSchema> {
  const schemas: Record<string, UnifiedJsonSchema> = {};

  for (const res of resources) {
    if (res.namespace === "rbac") continue;

    const schema: UnifiedJsonSchema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `${res.namespace}/${res.name}`,
      type: "object",
      properties: {},
      required: [],
    };

    let hasContent = false;

    for (const rel of res.relations) {
      if (
        rel.body.kind === "assignable" &&
        rel.body.cardinality === "ExactlyOne"
      ) {
        // Kessel convention: all ExactlyOne assignable relations use UUID identifiers.
        const idField = `${rel.name}_id`;
        schema.properties[idField] = {
          type: "string",
          format: "uuid",
          source: `relation ${rel.name}: ${rel.body.target} [ExactlyOne]`,
        };
        schema.required.push(idField);
        hasContent = true;
      }
    }

    if (hasContent) {
      schemas[`${res.namespace}/${res.name}`] = schema;
    }
  }

  return schemas;
}

export function generateMetadata(
  resources: ResourceDef[],
  extensions: V1Extension[],
  annotations?: Map<string, AnnotationEntry[]>,
  cascadePolicies?: CascadeDeleteEntry[],
): Record<string, ServiceMetadata> {
  const metadata: Record<string, ServiceMetadata> = {};

  function ensure(app: string): ServiceMetadata {
    if (!metadata[app]) {
      metadata[app] = { permissions: [], resources: [] };
    }
    return metadata[app];
  }

  for (const ext of extensions) {
    ensure(ext.application).permissions.push(ext.v2Perm);
  }

  for (const res of resources) {
    if (res.namespace === "rbac") continue;
    const ns = res.namespace.split("/").pop() || res.namespace;
    ensure(ns).resources.push(res.name);
  }

  if (cascadePolicies) {
    for (const cp of cascadePolicies) {
      const svc = ensure(cp.childApplication.toLowerCase());
      if (!svc.cascadeDeletePolicies) svc.cascadeDeletePolicies = [];
      svc.cascadeDeletePolicies.push(`${cp.childResource} via ${cp.parentRelation}`);
    }
  }

  if (annotations) {
    for (const [resourceKey, entries] of annotations) {
      const app = resourceKey.split("/")[0];
      const svc = ensure(app);
      if (!svc.annotations) svc.annotations = {};
      for (const e of entries) {
        svc.annotations[`${resourceKey}:${e.key}`] = e.value;
      }
    }
  }

  return metadata;
}

export function generateIR(
  mainFile: string,
  fullSchema: ResourceDef[],
  extensions: V1Extension[],
  annotations?: Map<string, AnnotationEntry[]>,
  cascadePolicies?: CascadeDeleteEntry[],
): IntermediateRepresentation {
  const ir: IntermediateRepresentation = {
    version: IR_VERSION,
    generatedAt: new Date().toISOString(),
    source: `schema/${path.basename(mainFile)}`,
    resources: fullSchema,
    extensions,
    spicedb: generateSpiceDB(fullSchema),
    metadata: generateMetadata(fullSchema, extensions, annotations, cascadePolicies),
    jsonSchemas: generateUnifiedJsonSchemas(fullSchema),
  };

  if (annotations && annotations.size > 0) {
    ir.annotations = flattenAnnotations(annotations);
  }

  return ir;
}
