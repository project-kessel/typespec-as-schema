import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pocRoot = path.resolve(__dirname, "../..");
const mainTsp = path.resolve(pocRoot, "schema/main.tsp");
const emitter = path.resolve(pocRoot, "src/spicedb-emitter.ts");

function run(flags: string = ""): { stdout: string; stderr: string } {
  const cmd = `npx tsx ${emitter} ${mainTsp} ${flags}`;
  try {
    const stdout = execSync(cmd, {
      cwd: pocRoot,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    return { stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    if (err.status !== 0 && err.status != null) {
      throw new Error(`CLI exited ${err.status}: ${err.stderr ?? ""}`);
    }
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("CLI smoke tests (spicedb-emitter)", () => {
  it("default: outputs SpiceDB Zed schema", () => {
    const { stdout } = run();
    expect(stdout).toContain("definition");
    expect(stdout).toContain("rbac/");
  }, 30_000);

  it("--metadata: outputs valid JSON with application keys", () => {
    const { stdout } = run("--metadata");
    const parsed = JSON.parse(stdout);
    expect(typeof parsed).toBe("object");
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
    const firstApp = Object.values(parsed)[0] as Record<string, unknown>;
    expect(firstApp).toHaveProperty("permissions");
    expect(firstApp).toHaveProperty("resources");
  }, 30_000);

  it("--ir writes file and exits 0", () => {
    const outPath = path.resolve(pocRoot, "test/fixtures/.tmp-cli-test-ir.json");
    try {
      run(`--ir ${outPath}`);
      expect(fs.existsSync(outPath)).toBe(true);
      const ir = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      expect(ir).toHaveProperty("version");
      expect(ir).toHaveProperty("resources");
      expect(ir).toHaveProperty("spicedb");
    } finally {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    }
  }, 30_000);

  it("--unified-jsonschema: outputs valid JSON", () => {
    const { stdout } = run("--unified-jsonschema");
    const parsed = JSON.parse(stdout);
    expect(typeof parsed).toBe("object");
  }, 30_000);

  it("--annotations: outputs valid JSON", () => {
    const { stdout } = run("--annotations");
    const parsed = JSON.parse(stdout);
    expect(typeof parsed).toBe("object");
  }, 30_000);

  it("--preview inventory_host_view: outputs preview text", () => {
    const { stdout } = run("--preview inventory_host_view");
    expect(stdout).toContain("Preview:");
    expect(stdout).toContain("inventory_host_view");
  }, 30_000);

  it("--no-strict: does not throw on diagnostics", () => {
    expect(() => run("--no-strict")).not.toThrow();
  }, 30_000);
});
