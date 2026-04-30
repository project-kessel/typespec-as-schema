import * as path from "path";
import { fileURLToPath } from "url";
import {
  compile,
  NodeHost,
  discoverResources,
  generateSpiceDB,
  generateMetadata,
  generateUnifiedJsonSchemas,
  generateIR,
  type ResourceDef,
  type UnifiedJsonSchema,
  type V1Extension,
} from "../../src/lib.js";
import {
  discoverV1Permissions,
  discoverAnnotations,
  discoverCascadeDeletePolicies,
  expandV1Permissions,
  expandCascadeDeletePolicies,
} from "../../src/expand.js";
import type { AnnotationEntry, CascadeDeleteEntry } from "../../src/expand.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pocRoot = path.resolve(__dirname, "../..");
export const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
export const goldenDir = path.resolve(pocRoot, "test/fixtures");

export interface PipelineResult {
  resources: ResourceDef[];
  extensions: V1Extension[];
  annotations: Map<string, AnnotationEntry[]>;
  cascadePolicies: CascadeDeleteEntry[];
  fullSchema: ResourceDef[];
  spicedbOutput: string;
  unifiedJsonSchemas: Record<string, UnifiedJsonSchema>;
}

/**
 * Compiles the main.tsp schema and runs the full discovery/expansion pipeline.
 * Shared across integration tests to avoid duplicating setup logic.
 */
export async function compilePipeline(): Promise<PipelineResult> {
  const program = await compile(NodeHost, mainTsp, { noEmit: true });
  const resources = discoverResources(program).resources;
  const extensions = discoverV1Permissions(program);
  const annotations = discoverAnnotations(program);
  const cascadePolicies = discoverCascadeDeletePolicies(program);
  const v1Expanded = expandV1Permissions(resources, extensions);
  const fullSchema = expandCascadeDeletePolicies(v1Expanded, cascadePolicies);
  const spicedbOutput = generateSpiceDB(fullSchema);
  const unifiedJsonSchemas = generateUnifiedJsonSchemas(fullSchema);

  return {
    resources,
    extensions,
    annotations,
    cascadePolicies,
    fullSchema,
    spicedbOutput,
    unifiedJsonSchemas,
  };
}

export { generateMetadata, generateIR };
