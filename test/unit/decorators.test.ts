import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import { StateKeys } from "../../src/lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(__dirname, "../../lib");
const distDir = path.resolve(__dirname, "../../dist/index.js");
const rbacExtDir = path.resolve(__dirname, "../../schema/rbac");

async function compileInlineWithLib(tspSource: string): Promise<Program> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "decorator-test-"));
  const mainFile = path.join(tmpDir, "main.tsp");

  const fullSource = [
    `import "${distDir}";`,
    `import "${libDir}/decorators.tsp";`,
    `import "${libDir}/kessel.tsp";`,
    `import "${libDir}/kessel-extensions.tsp";`,
    `import "${rbacExtDir}/rbac-extensions.tsp";`,
    ``,
    tspSource,
  ].join("\n");
  fs.writeFileSync(mainFile, fullSource);

  return compile(NodeHost, mainFile, { noEmit: true });
}

describe("@kesselExtension decorator", () => {
  it("populates the kesselExtension state set", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @kesselExtension
      model myPerm is V1WorkspacePermission<"myapp", "widget", "read", "myapp_widget_view"> {}
    `);

    const stateSet = program.stateSet(StateKeys.kesselExtension);
    expect(stateSet.size).toBe(1);
  }, 30_000);

  it("does not populate state set without decorator", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      model myPerm is V1WorkspacePermission<"myapp", "widget", "read", "myapp_widget_view"> {}
    `);

    const stateSet = program.stateSet(StateKeys.kesselExtension);
    expect(stateSet.size).toBe(0);
  }, 30_000);
});

describe("@cascadePolicy decorator", () => {
  it("populates the cascadePolicy state set", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @cascadePolicy
      model myCascade is CascadeDeletePolicy<"inventory", "host", "workspace"> {}
    `);

    const stateSet = program.stateSet(StateKeys.cascadePolicy);
    expect(stateSet.size).toBe(1);
  }, 30_000);
});

describe("@annotation decorator", () => {
  it("populates the annotation state set", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @annotation
      model myAnnotation is ResourceAnnotation<"inventory", "host", "feature_flag", "v2"> {}
    `);

    const stateSet = program.stateSet(StateKeys.annotation);
    expect(stateSet.size).toBe(1);
  }, 30_000);
});

