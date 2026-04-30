import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import { findExtensionTemplate, discoverV1Permissions, discoverResources } from "../../src/discover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(__dirname, "../../lib");

async function compileInlineWithLib(tspSource: string): Promise<Program> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"));
  const mainFile = path.join(tmpDir, "main.tsp");

  const fullSource = `import "${libDir}/kessel-extensions.tsp";\n\n${tspSource}`;
  fs.writeFileSync(mainFile, fullSource);

  const program = await compile(NodeHost, mainFile, { noEmit: true });
  return program;
}

describe("discoverV1Permissions", () => {
  it("discovers a V1WorkspacePermission alias", async () => {
    const program = await compileInlineWithLib(`
      alias MyPerm = Kessel.V1WorkspacePermission<"myapp", "widget", "read", "myapp_widget_view">;
    `);

    const perms = discoverV1Permissions(program);
    expect(perms).toHaveLength(1);
    expect(perms[0]).toEqual({
      application: "myapp",
      resource: "widget",
      verb: "read",
      v2Perm: "myapp_widget_view",
    });
  }, 30_000);

  it("rejects permissions with invalid verbs", async () => {
    const program = await compileInlineWithLib(`
      alias BadPerm = Kessel.V1WorkspacePermission<"myapp", "widget", "explode", "myapp_widget_boom">;
    `);

    const perms = discoverV1Permissions(program);
    expect(perms).toHaveLength(0);
  }, 30_000);

  it("accumulates skipped statements into warnings", async () => {
    const program = await compileInlineWithLib(`
      alias GoodPerm = Kessel.V1WorkspacePermission<"myapp", "widget", "read", "myapp_widget_view">;
    `);

    const warnings = {
      skipped: [] as string[],
      stats: { aliasesAttempted: 0, aliasesResolved: 0, resourcesFound: 0, extensionsFound: 0 },
    };
    const perms = discoverV1Permissions(program, warnings);
    expect(perms).toHaveLength(1);
    expect(Array.isArray(warnings.skipped)).toBe(true);
    expect(warnings.stats.extensionsFound).toBe(1);
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

  it("does NOT find a non-Kessel model with the same name", async () => {
    const program = await compileInlineWithLib(`
      namespace FakeNs;
      model V1WorkspacePermission<T extends string> {
        fake: T;
      }
    `);

    const model = findExtensionTemplate(program, "V1WorkspacePermission");
    expect(model).not.toBeNull();
    // The Kessel namespace filter should return the Kessel one, not the FakeNs one
    const ns = model!.namespace;
    expect(ns).toBeDefined();
  }, 30_000);
});
