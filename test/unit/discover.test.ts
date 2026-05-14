import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import { discoverResources } from "../../src/discover-resources.js";
import { slotName } from "../../src/lib.js";
import { discoverV1Permissions } from "../../src/providers/rbac/rbac-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(__dirname, "../../lib");
const rbacExtDir = path.resolve(__dirname, "../../schema/rbac");

async function compileInlineWithLib(tspSource: string): Promise<Program> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"));
  const mainFile = path.join(tmpDir, "main.tsp");

  const fullSource = `import "${libDir}/kessel-extensions.tsp";\nimport "${rbacExtDir}/rbac-extensions.tsp";\n\n${tspSource}`;
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

  it("discovers Permission<SubRef<...>> as a subref relation", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      model Widget {
        workspace: Assignable<string, Cardinality.ExactlyOne>;
        view: Permission<SubRef<"workspace", "some_perm">>;
      }
    `);

    const { resources } = discoverResources(program);
    const widget = resources.find((r) => r.name === "widget");
    expect(widget).toBeDefined();
    const viewRel = widget!.relations.find((r) => r.name === "view");
    expect(viewRel).toBeDefined();
    expect(viewRel!.body).toEqual({
      kind: "subref",
      name: slotName("workspace"),
      subname: "some_perm",
    });
  }, 30_000);

  it("discovers Permission<Ref<...>> as a ref relation", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      model Widget {
        workspace: Assignable<string, Cardinality.ExactlyOne>;
        view: Permission<Ref<"subject">>;
      }
    `);

    const { resources } = discoverResources(program);
    const widget = resources.find((r) => r.name === "widget");
    const viewRel = widget!.relations.find((r) => r.name === "view");
    expect(viewRel).toBeDefined();
    expect(viewRel!.body).toEqual({
      kind: "ref",
      name: "subject",
    });
  }, 30_000);

  it("discovers Permission<Or<...>> as a union", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      model Widget {
        workspace: Assignable<string, Cardinality.ExactlyOne>;
        view: Permission<Or<SubRef<"workspace", "perm_a">, SubRef<"workspace", "perm_b">>>;
      }
    `);

    const { resources } = discoverResources(program);
    const widget = resources.find((r) => r.name === "widget");
    const viewRel = widget!.relations.find((r) => r.name === "view");
    expect(viewRel).toBeDefined();
    expect(viewRel!.body).toEqual({
      kind: "or",
      members: [
        { kind: "subref", name: slotName("workspace"), subname: "perm_a" },
        { kind: "subref", name: slotName("workspace"), subname: "perm_b" },
      ],
    });
  }, 30_000);

  it("discovers Permission<And<...>> as an intersection", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      model Widget {
        workspace: Assignable<string, Cardinality.ExactlyOne>;
        view: Permission<And<Ref<"subject">, SubRef<"granted", "perm">>>;
      }
    `);

    const { resources } = discoverResources(program);
    const widget = resources.find((r) => r.name === "widget");
    const viewRel = widget!.relations.find((r) => r.name === "view");
    expect(viewRel).toBeDefined();
    expect(viewRel!.body).toEqual({
      kind: "and",
      members: [
        { kind: "ref", name: "subject" },
        { kind: "subref", name: slotName("granted"), subname: "perm" },
      ],
    });
  }, 30_000);
});
