import * as path from "path";
import {
  IR_VERSION,
  type ResourceDef,
  type UnifiedJsonSchema,
  type JsonSchemaProperty,
  type DataFieldDef,
  type DataFieldSchema,
  type ServiceMetadata,
  type IntermediateRepresentation,
  type CascadeDeleteEntry,
  type AnnotationEntry,
} from "./types.js";
import { bodyToZed, slotName, flattenAnnotations, isAssignable } from "./utils.js";
import type { ProviderDiscoveryResult } from "./types.js";
import type { ExtensionProvider } from "./provider.js";

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

function dataFieldSchemaToProperty(schema: DataFieldSchema): JsonSchemaProperty {
  if ("oneOf" in schema) {
    return { oneOf: schema.oneOf.map(dataFieldSchemaToProperty) };
  }
  const prop: JsonSchemaProperty = { type: schema.type };
  if ("format" in schema && schema.format) (prop as Record<string, unknown>).format = schema.format;
  if ("maxLength" in schema && schema.maxLength !== undefined) (prop as Record<string, unknown>).maxLength = schema.maxLength;
  if ("minLength" in schema && schema.minLength !== undefined) (prop as Record<string, unknown>).minLength = schema.minLength;
  if ("pattern" in schema && schema.pattern) (prop as Record<string, unknown>).pattern = schema.pattern;
  if ("minimum" in schema && schema.minimum !== undefined) (prop as Record<string, unknown>).minimum = schema.minimum;
  if ("maximum" in schema && schema.maximum !== undefined) (prop as Record<string, unknown>).maximum = schema.maximum;
  return prop;
}

const NULL_SCHEMA: JsonSchemaProperty = { type: "null" };

function dataFieldToProperty(field: DataFieldDef): JsonSchemaProperty {
  const base = dataFieldSchemaToProperty(field.schema);
  if (field.required) return base;
  if ("oneOf" in base) {
    return { oneOf: [...base.oneOf, NULL_SCHEMA] };
  }
  return { oneOf: [base, NULL_SCHEMA] };
}

/**
 * Generates unified JSON schemas for resources, excluding provider-owned
 * namespaces (e.g., "rbac") which are internal to their provider.
 */
export function generateUnifiedJsonSchemas(
  resources: ResourceDef[],
  ownedNamespaces?: Set<string>,
): Record<string, UnifiedJsonSchema> {
  const schemas: Record<string, UnifiedJsonSchema> = {};
  const skip = ownedNamespaces ?? new Set<string>();

  for (const res of resources) {
    if (skip.has(res.namespace)) continue;

    const schema: UnifiedJsonSchema = {
      $schema: "http://json-schema.org/draft-07/schema#",
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

    if (res.dataFields) {
      for (const field of res.dataFields) {
        schema.properties[field.name] = dataFieldToProperty(field);
        if (field.required) schema.required.push(field.name);
        hasContent = true;
      }
    }

    if (hasContent) {
      schemas[`${res.namespace}/${res.name}`] = schema;
    }
  }

  return schemas;
}

/**
 * Generates service metadata from provider discovery results and resources.
 * Param key mapping is driven by the provider interface — no hard-coded keys.
 */
export function generateMetadata(
  resources: ResourceDef[],
  providerResults: ProviderDiscoveryResult[],
  providerMap: ReadonlyMap<string, ExtensionProvider>,
  ownedNamespaces?: Set<string>,
  annotations?: Map<string, AnnotationEntry[]>,
  cascadePolicies?: CascadeDeleteEntry[],
): Record<string, ServiceMetadata> {
  const metadata: Record<string, ServiceMetadata> = {};
  const skip = ownedNamespaces ?? new Set<string>();

  function ensure(app: string): ServiceMetadata {
    if (!metadata[app]) {
      metadata[app] = { permissions: [], resources: [] };
    }
    return metadata[app];
  }

  for (const pr of providerResults) {
    const provider = providerMap.get(pr.providerId);
    const appKey = provider?.applicationParamKey;
    const permKey = provider?.permissionParamKey;
    if (!appKey || !permKey) continue;
    for (const ext of pr.discovered) {
      const app = ext.params[appKey];
      const perm = ext.params[permKey];
      if (app && perm) {
        ensure(app).permissions.push(perm);
      }
    }
  }

  for (const res of resources) {
    if (skip.has(res.namespace)) continue;
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
  providerResults: ProviderDiscoveryResult[],
  providerMap: ReadonlyMap<string, ExtensionProvider>,
  ownedNamespaces?: Set<string>,
  annotations?: Map<string, AnnotationEntry[]>,
  cascadePolicies?: CascadeDeleteEntry[],
): IntermediateRepresentation {
  const extensionsByProvider: Record<string, Record<string, string>[]> = {};
  for (const pr of providerResults) {
    extensionsByProvider[pr.providerId] = pr.discovered.map((d) => d.params);
  }

  const ir: IntermediateRepresentation = {
    version: IR_VERSION,
    generatedAt: new Date().toISOString(),
    source: `schema/${path.basename(mainFile)}`,
    resources: fullSchema,
    extensions: extensionsByProvider,
    spicedb: generateSpiceDB(fullSchema),
    metadata: generateMetadata(fullSchema, providerResults, providerMap, ownedNamespaces, annotations, cascadePolicies),
    jsonSchemas: generateUnifiedJsonSchemas(fullSchema, ownedNamespaces),
  };

  if (annotations && annotations.size > 0) {
    ir.annotations = flattenAnnotations(annotations);
  }

  return ir;
}
