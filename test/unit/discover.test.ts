import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import * as fs from "fs";
import * as os from "os";
import { compile, NodeHost, type Program } from "@typespec/compiler";
import { discoverResources } from "../../src/discover-resources.js";
import { slotName, StateKeys } from "../../src/lib.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(__dirname, "../../lib");
const distDir = path.resolve(__dirname, "../../dist/index.js");

async function compileInlineWithLib(tspSource: string): Promise<Program> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "discover-test-"));
  const mainFile = path.join(tmpDir, "main.tsp");

  const fullSource = [
    `import "${distDir}";`,
    `import "${libDir}/kessel.tsp";`,
    `import "${libDir}/decorators.tsp";`,
    ``,
    tspSource,
  ].join("\n");
  fs.writeFileSync(mainFile, fullSource);

  const program = await compile(NodeHost, mainFile, { noEmit: true });
  return program;
}

describe("@v1Permission decorator discovery", () => {
  it("discovers permissions from @v1Permission decorator", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @v1Permission("myapp", "widget", "read", "myapp_widget_view")
      model Widget {}
    `);

    const stateMap = program.stateMap(StateKeys.v1Permission);
    const allPerms: Array<{ application: string; resource: string; verb: string; v2Perm: string }> = [];
    for (const [, entries] of stateMap) {
      allPerms.push(...(entries as typeof allPerms));
    }
    expect(allPerms).toHaveLength(1);
    expect(allPerms[0]).toEqual({
      application: "myapp",
      resource: "widget",
      verb: "read",
      v2Perm: "myapp_widget_view",
    });
  }, 30_000);

  it("supports multiple @v1Permission decorators on one model", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @v1Permission("myapp", "widget", "read", "myapp_widget_view")
      @v1Permission("myapp", "widget", "write", "myapp_widget_update")
      model Widget {}
    `);

    const stateMap = program.stateMap(StateKeys.v1Permission);
    const allPerms: Array<{ application: string; resource: string; verb: string; v2Perm: string }> = [];
    for (const [, entries] of stateMap) {
      allPerms.push(...(entries as typeof allPerms));
    }
    expect(allPerms).toHaveLength(2);
    expect(allPerms.map((p) => p.v2Perm).sort()).toEqual(["myapp_widget_update", "myapp_widget_view"]);
  }, 30_000);

  it("discovers permissions across multiple models", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @v1Permission("myapp", "widget", "read", "myapp_widget_view")
      model Widget {}
      @v1Permission("myapp", "gadget", "read", "myapp_gadget_view")
      model Gadget {}
    `);

    const stateMap = program.stateMap(StateKeys.v1Permission);
    const allPerms: Array<{ application: string; resource: string; verb: string; v2Perm: string }> = [];
    for (const [, entries] of stateMap) {
      allPerms.push(...(entries as typeof allPerms));
    }
    expect(allPerms).toHaveLength(2);
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
