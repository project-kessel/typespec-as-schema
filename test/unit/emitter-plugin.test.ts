import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(import.meta.dirname!, "../..");
const OUTPUT_DIR = path.resolve(ROOT, "tsp-output/typespec-as-schema");

describe("tsp compile emitter plugin", () => {
  it("produces schema.zed via tsp compile (single command)", () => {
    execSync("npx tsc -p tsconfig.build.json", { cwd: ROOT, stdio: "pipe" });
    execSync("npx tsp compile schema/main.tsp", { cwd: ROOT, stdio: "pipe" });

    const zedPath = path.resolve(OUTPUT_DIR, "schema.zed");
    expect(fs.existsSync(zedPath)).toBe(true);

    const content = fs.readFileSync(zedPath, "utf-8");
    expect(content).toContain("definition rbac/principal");
    expect(content).toContain("definition rbac/role");
    expect(content).toContain("definition rbac/workspace");
    expect(content).toContain("definition inventory/host");
    expect(content).toContain("permission inventory_host_view");
    expect(content).toContain("permission view_metadata");
  });

  it("SpiceDB output contains expected resource definitions", () => {
    const content = fs.readFileSync(
      path.resolve(OUTPUT_DIR, "schema.zed"),
      "utf-8",
    );

    const definitions = content
      .split("\n")
      .filter((l) => l.startsWith("definition "))
      .map((l) => l.replace("definition ", "").replace(" {", "").trim());

    expect(definitions).toContain("rbac/principal");
    expect(definitions).toContain("rbac/role");
    expect(definitions).toContain("rbac/role_binding");
    expect(definitions).toContain("rbac/workspace");
    expect(definitions).toContain("inventory/host");
    expect(definitions.length).toBe(5);
  });
});
