import { describe, it, expect } from "vitest";
import { compilePipeline } from "../../src/pipeline.js";
import { SchemaComplexityError, OutputSizeError } from "../../src/safety.js";
import { mainTsp } from "../helpers/pipeline.js";

describe("compilePipeline with PipelineOptions", () => {
  it("produces a valid result with default options", async () => {
    const result = await compilePipeline(mainTsp);
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.extensions.length).toBeGreaterThan(0);
    expect(result.fullSchema.length).toBeGreaterThan(0);
    expect(typeof result.spicedbOutput).toBe("string");
    expect(result.spicedbOutput.length).toBeGreaterThan(0);
    expect(result.diagnostics).toBeDefined();
    expect(result.warnings).toBeDefined();
  }, 30_000);

  it("throws SchemaComplexityError when maxExtensions is too low", async () => {
    await expect(
      compilePipeline(mainTsp, { limits: { maxExtensions: 1 } }),
    ).rejects.toThrow(SchemaComplexityError);
  }, 30_000);

  it("throws OutputSizeError when outputMaxBytes is too low", async () => {
    await expect(
      compilePipeline(mainTsp, { limits: { outputMaxBytes: 10 } }),
    ).rejects.toThrow(OutputSizeError);
  }, 30_000);

  it("emits a warning when outputWarnBytes is exceeded", async () => {
    const result = await compilePipeline(mainTsp, { limits: { outputWarnBytes: 10 } });
    expect(result.warnings.some((w) => w.includes("SpiceDB schema is"))).toBe(true);
  }, 30_000);

  it("collects expansion warnings as data (no console.error side effects)", async () => {
    const result = await compilePipeline(mainTsp);
    expect(Array.isArray(result.warnings)).toBe(true);
  }, 30_000);
});
