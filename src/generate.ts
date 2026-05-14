import type { ResourceDef, UnifiedJsonSchema, CascadeDeleteEntry, AnnotationEntry, ServiceMetadata } from "./types.js";
import { bodyToZed, slotName, isAssignable } from "./utils.js";

export interface MetadataContribution {
  permissionsByApp: Record<string, string[]>;
}

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
  ownedNamespaces?: Set<string>,
): Record<string, UnifiedJsonSchema> {
  const schemas: Record<string, UnifiedJsonSchema> = {};
  const skip = ownedNamespaces ?? new Set<string>();

  for (const res of resources) {
    if (skip.has(res.namespace)) continue;

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
  providerContributions: MetadataContribution[],
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

  for (const contribution of providerContributions) {
    for (const [app, perms] of Object.entries(contribution.permissionsByApp)) {
      const svc = ensure(app);
      svc.permissions.push(...perms);
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
