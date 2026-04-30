import * as path from "path";
import { fileURLToPath } from "url";
import { generateMetadata, generateIR } from "../../src/generate.js";
import { compilePipeline as runPipeline, type PipelineResult } from "../../src/pipeline.js";

export type { PipelineResult };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pocRoot = path.resolve(__dirname, "../..");
export const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
export const goldenDir = path.resolve(pocRoot, "test/fixtures");

/**
 * Compiles the main.tsp schema through the real pipeline — the same
 * compile -> discover -> validate -> expand -> validate -> generate path
 * that the CLI uses. No shadow implementation.
 */
export async function compilePipeline(): Promise<PipelineResult> {
  return runPipeline(mainTsp);
}

export { generateMetadata, generateIR };
