import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import { discoverTemplateInstances, type TemplateDef } from "../../src/discover-templates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rbacExtDir = path.resolve(__dirname, "../../schema/rbac");

async function compileInline(tspSource: string): Promise<Program> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-tpl-test-"));
  const mainFile = path.join(tmpDir, "main.tsp");
  const fullSource = `import "${rbacExtDir}/rbac-extensions.tsp";\n\n${tspSource}`;
  fs.writeFileSync(mainFile, fullSource);
  return compile(NodeHost, mainFile, { noEmit: true });
}

const V1_TEMPLATE: TemplateDef = {
  templateName: "V1WorkspacePermission",
  paramNames: ["application", "resource", "verb", "v2Perm"],
  namespace: "RBAC",
};

describe("discoverTemplateInstances", () => {
  it("discovers alias-based template instances", async () => {
    const program = await compileInline(`
      alias MyPerm = RBAC.V1WorkspacePermission<"myapp", "widget", "read", "myapp_widget_view">;
    `);

    const result = discoverTemplateInstances(program, V1_TEMPLATE);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      application: "myapp",
      resource: "widget",
      verb: "read",
      v2Perm: "myapp_widget_view",
    });
  }, 30_000);

  it("discovers multiple aliases and deduplicates", async () => {
    const program = await compileInline(`
      alias A = RBAC.V1WorkspacePermission<"app", "res", "read", "app_res_view">;
      alias B = RBAC.V1WorkspacePermission<"app", "res", "write", "app_res_update">;
      alias Dup = RBAC.V1WorkspacePermission<"app", "res", "read", "app_res_view">;
    `);

    const result = discoverTemplateInstances(program, V1_TEMPLATE);
    expect(result.results).toHaveLength(2);
  }, 30_000);

  it("returns empty results when template is not found", async () => {
    const program = await compileInline(`
      namespace Empty;
      model Foo { x: string; }
    `);

    const fakeDef: TemplateDef = {
      templateName: "NonexistentTemplate",
      paramNames: ["a"],
      namespace: "Fake",
    };
    const result = discoverTemplateInstances(program, fakeDef);
    expect(result.results).toHaveLength(0);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped[0]).toContain("not found");
  }, 30_000);

  it("tracks alias resolution stats", async () => {
    const program = await compileInline(`
      alias Perm = RBAC.V1WorkspacePermission<"app", "res", "read", "app_res_view">;
    `);

    const result = discoverTemplateInstances(program, V1_TEMPLATE);
    expect(result.aliasesAttempted).toBeGreaterThan(0);
    expect(result.aliasesResolved).toBeGreaterThan(0);
  }, 30_000);
});
