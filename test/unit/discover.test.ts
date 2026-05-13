import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import { findExtensionTemplate, discoverExtensionInstances } from "../../src/discover-extensions.js";
import { discoverResources } from "../../src/discover-resources.js";
import { getNamespaceFQN } from "../../src/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(__dirname, "../../lib");
const rbacExtDir = path.resolve(__dirname, "../../schema/rbac");

const V1_TEMPLATE = { templateName: "V1WorkspacePermission", paramNames: ["application", "resource", "verb", "v2Perm"], namespace: "Kessel" };

async function compileInlineWithLib(tspSource: string): Promise<Program> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"));
  const mainFile = path.join(tmpDir, "main.tsp");

  const fullSource = `import "${libDir}/kessel-extensions.tsp";\nimport "${rbacExtDir}/rbac-extensions.tsp";\n\n${tspSource}`;
  fs.writeFileSync(mainFile, fullSource);

  const program = await compile(NodeHost, mainFile, { noEmit: true });
  return program;
}

describe("discoverExtensionInstances (V1WorkspacePermission)", () => {
  it("discovers a V1WorkspacePermission alias", async () => {
    const program = await compileInlineWithLib(`
      alias MyPerm = Kessel.V1WorkspacePermission<"myapp", "widget", "read", "myapp_widget_view">;
    `);

    const { results } = discoverExtensionInstances(program, V1_TEMPLATE);
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      application: "myapp",
      resource: "widget",
      verb: "read",
      v2Perm: "myapp_widget_view",
    });
  }, 30_000);

  it("invalid constraint params resolve as undefined (provider ignores gracefully)", async () => {
    const program = await compileInlineWithLib(`
      alias BadPerm = Kessel.V1WorkspacePermission<"myapp", "widget", "explode", "myapp_widget_boom">;
    `);

    const { results } = discoverExtensionInstances(program, V1_TEMPLATE);
    expect(results).toHaveLength(1);
    expect(results[0].verb).toBeUndefined();
  }, 30_000);

  it("reports discovery stats", async () => {
    const program = await compileInlineWithLib(`
      alias GoodPerm = Kessel.V1WorkspacePermission<"myapp", "widget", "read", "myapp_widget_view">;
    `);

    const { results, aliasesAttempted, aliasesResolved } = discoverExtensionInstances(program, V1_TEMPLATE);
    expect(results).toHaveLength(1);
    expect(aliasesAttempted).toBeGreaterThanOrEqual(1);
    expect(aliasesResolved).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe("discoverResources", () => {
  it("skips models in the Kessel namespace", async () => {
    const program = await compileInlineWithLib(`
      namespace TestApp;
      model Widget {
        workspace: Kessel.Assignable<string, Kessel.Cardinality.ExactlyOne>;
      }
    `);

    const { resources } = discoverResources(program);
    const kesselResources = resources.filter((r) => r.namespace.endsWith("kessel"));
    expect(kesselResources).toHaveLength(0);

    const widget = resources.find((r) => r.name === "widget");
    expect(widget).toBeDefined();
  }, 30_000);
});

describe("findExtensionTemplate Kessel namespace filter", () => {
  it("finds V1WorkspacePermission in the Kessel namespace", async () => {
    const program = await compileInlineWithLib(``);
    const model = findExtensionTemplate(program, "V1WorkspacePermission");
    expect(model).not.toBeNull();
    expect(model!.name).toBe("V1WorkspacePermission");
  }, 30_000);

  it("finds a model by name even when multiple namespaces define it", async () => {
    const program = await compileInlineWithLib(`
      namespace FakeNs;
      model V1WorkspacePermission<T extends string> {
        fake: T;
      }
    `);

    const model = findExtensionTemplate(program, "V1WorkspacePermission", "Kessel");
    expect(model).not.toBeNull();
    expect(getNamespaceFQN(model!.namespace!)).toContain("Kessel");
  }, 30_000);
});
