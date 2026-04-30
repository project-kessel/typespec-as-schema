import type {
  ResourceDef,
  V1Extension,
  UnifiedJsonSchema,
  ServiceMetadata,
  IntermediateRepresentation,
} from "./types.js";
import { bodyToZed } from "./utils.js";

function isAssignable(body: ResourceDef["relations"][number]["body"]): boolean {
  return body.kind === "assignable" || body.kind === "bool";
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
      const tName = `t_${rel.name}`;
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
  extensions: V1Extension[]
): Record<string, ServiceMetadata> {
  const metadata: Record<string, ServiceMetadata> = {};

  for (const ext of extensions) {
    if (!metadata[ext.application]) {
      metadata[ext.application] = { permissions: [], resources: [] };
    }
    metadata[ext.application].permissions.push(ext.v2Perm);
  }

  for (const res of resources) {
    if (res.namespace === "rbac") continue;
    const ns = res.namespace.split("/").pop() || res.namespace;
    if (!metadata[ns]) {
      metadata[ns] = { permissions: [], resources: [] };
    }
    metadata[ns].resources.push(res.name);
  }

  return metadata;
}

export function generateIR(
  mainFile: string,
  fullSchema: ResourceDef[],
  extensions: V1Extension[],
  annotations?: Map<string, { key: string; value: string }[]>,
): IntermediateRepresentation {
  const ir: IntermediateRepresentation = {
    version: "1.2.0",
    generatedAt: new Date().toISOString(),
    source: mainFile,
    resources: fullSchema,
    extensions,
    spicedb: generateSpiceDB(fullSchema),
    metadata: generateMetadata(fullSchema, extensions),
    jsonSchemas: generateUnifiedJsonSchemas(fullSchema),
  };

  if (annotations && annotations.size > 0) {
    const out: Record<string, Record<string, string>> = {};
    for (const [resourceKey, entries] of annotations) {
      const obj: Record<string, string> = {};
      for (const e of entries) {
        obj[e.key] = e.value;
      }
      out[resourceKey] = obj;
    }
    ir.annotations = out;
  }

  return ir;
}
