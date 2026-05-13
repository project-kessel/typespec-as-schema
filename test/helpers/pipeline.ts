import * as path from "path";
import { fileURLToPath } from "url";
import { generateMetadata, generateIR } from "../../src/generate.js";
import { compilePipeline as runPipeline, type PipelineResult, type PipelineOptions } from "../../src/pipeline.js";
import { rbacProvider } from "../../schema/rbac/rbac-provider.js";
import { hbiProvider } from "../../schema/hbi/hbi-provider.js";

export type { PipelineResult };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pocRoot = path.resolve(__dirname, "../..");
export const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
export const goldenDir = path.resolve(pocRoot, "test/fixtures");

export const DEFAULT_TEST_PROVIDERS = [rbacProvider, hbiProvider];

/**
 * Compiles the main.tsp schema through the real pipeline — the same
 * compile -> discover -> validate -> expand -> validate -> generate path
 * that the CLI uses. Providers are supplied explicitly.
 */
export async function compilePipeline(options?: Partial<PipelineOptions>): Promise<PipelineResult> {
  return runPipeline(mainTsp, { providers: DEFAULT_TEST_PROVIDERS, ...options });
}

export function allDiscovered(result: PipelineResult) {
  return result.providerResults.flatMap((pr) => pr.discovered);
}

export { generateMetadata, generateIR };
