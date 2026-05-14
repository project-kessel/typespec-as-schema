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

describe("@cascadePolicy decorator (legacy)", () => {
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

describe("@annotation decorator (legacy)", () => {
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

describe("@v1Permission decorator", () => {
  it("stores permission data in state map", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @v1Permission("myapp", "widget", "read", "myapp_widget_view")
      model Widget {}
    `);

    const stateMap = program.stateMap(StateKeys.v1Permission);
    expect(stateMap.size).toBe(1);
    const entries = [...stateMap.values()];
    const perms = entries[0] as Array<{ application: string; v2Perm: string }>;
    expect(perms).toHaveLength(1);
    expect(perms[0].application).toBe("myapp");
    expect(perms[0].v2Perm).toBe("myapp_widget_view");
  }, 30_000);

  it("supports multiple decorators on one model", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace TestApp;
      @v1Permission("myapp", "widget", "read", "myapp_widget_view")
      @v1Permission("myapp", "widget", "write", "myapp_widget_update")
      model Widget {}
    `);

    const stateMap = program.stateMap(StateKeys.v1Permission);
    const entries = [...stateMap.values()];
    const perms = entries[0] as Array<{ v2Perm: string }>;
    expect(perms).toHaveLength(2);
  }, 30_000);
});

describe("@cascadeDelete decorator", () => {
  it("stores cascade data in state map with inferred app/resource", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace Inventory;
      @cascadeDelete("workspace")
      model Host {
        workspace: Assignable<string, Cardinality.ExactlyOne>;
      }
    `);

    const stateMap = program.stateMap(StateKeys.cascadePolicy);
    expect(stateMap.size).toBe(1);
    const entries = [...stateMap.values()];
    const policies = entries[0] as Array<{ childApplication: string; childResource: string; parentRelation: string }>;
    expect(policies).toHaveLength(1);
    expect(policies[0].childApplication).toBe("inventory");
    expect(policies[0].childResource).toBe("host");
    expect(policies[0].parentRelation).toBe("workspace");
  }, 30_000);
});

describe("@resourceAnnotation decorator", () => {
  it("stores annotation data in state map with inferred app/resource", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace Inventory;
      @resourceAnnotation("retention_days", "90")
      model Host {
        workspace: Assignable<string, Cardinality.ExactlyOne>;
      }
    `);

    const stateMap = program.stateMap(StateKeys.annotation);
    expect(stateMap.size).toBe(1);
    const entries = [...stateMap.values()];
    const annotations = entries[0] as Array<{ application: string; resource: string; key: string; value: string }>;
    expect(annotations).toHaveLength(1);
    expect(annotations[0].application).toBe("inventory");
    expect(annotations[0].resource).toBe("host");
    expect(annotations[0].key).toBe("retention_days");
    expect(annotations[0].value).toBe("90");
  }, 30_000);

  it("supports multiple annotations on one model", async () => {
    const program = await compileInlineWithLib(`
      using Kessel;
      namespace Inventory;
      @resourceAnnotation("feature_flag", "staleness_v2")
      @resourceAnnotation("retention_days", "90")
      model Host {
        workspace: Assignable<string, Cardinality.ExactlyOne>;
      }
    `);

    const stateMap = program.stateMap(StateKeys.annotation);
    const entries = [...stateMap.values()];
    const annotations = entries[0] as Array<{ key: string }>;
    expect(annotations).toHaveLength(2);
  }, 30_000);
});
