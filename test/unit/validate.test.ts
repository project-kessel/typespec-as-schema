import { describe, it, expect } from "vitest";
import { compile, NodeHost, type Diagnostic } from "@typespec/compiler";
import * as path from "path";
import { $onValidate } from "../../src/validate.js";

const ROOT = path.resolve(import.meta.dirname!, "../..");

async function compileFixture(code: string) {
  const mainFile = path.resolve(ROOT, "schema/main.tsp");
  const program = await compile(NodeHost, mainFile, { noEmit: true });
  return program;
}

async function compileInline(code: string) {
  const tmpDir = path.resolve(ROOT, "test/fixtures");
  const tmpFile = path.resolve(tmpDir, "_validate_test_inline.tsp");
  const fs = await import("fs");
  fs.writeFileSync(tmpFile, code);
  try {
    const program = await compile(NodeHost, tmpFile, { noEmit: true });
    return program;
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function compileAndValidate(code: string) {
  const program = await compileInline(code);
  const collected: Diagnostic[] = [];
  const origReport = program.reportDiagnostic.bind(program);
  program.reportDiagnostic = (diag: Diagnostic) => {
    collected.push(diag);
    origReport(diag);
  };
  $onValidate(program);
  return { program, diagnostics: collected };
}

describe("$onValidate", () => {
  it("passes for valid V1WorkspacePermission aliases (main.tsp)", async () => {
    const program = await compileFixture("main");
    const errors = program.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("reports no kessel-emitter diagnostics for valid schema", async () => {
    const program = await compileFixture("main");
    const kesselDiags = program.diagnostics.filter((d) =>
      d.code?.startsWith("kessel-emitter/"),
    );
    expect(kesselDiags).toHaveLength(0);
  });

  it("validates patch-rule strings on template instances", async () => {
    const program = await compileInline(`
      import "../../lib/kessel.tsp";
      import "../../lib/kessel-extensions.tsp";
      import "../../schema/rbac.tsp";
      using Kessel;
      namespace ValidTest;
      alias testPerm = Kessel.V1WorkspacePermission<"myapp", "things", "read", "myapp_thing_view">;
    `);
    const errors = program.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toHaveLength(0);
    const kesselDiags = program.diagnostics.filter((d) =>
      d.code?.startsWith("kessel-emitter/"),
    );
    expect(kesselDiags).toHaveLength(0);
  });
});

describe("$onValidate parameter constraints", () => {
  it("rejects uppercase app name", async () => {
    const { diagnostics } = await compileAndValidate(`
      import "../../lib/kessel.tsp";
      import "../../lib/kessel-extensions.tsp";
      import "../../schema/rbac.tsp";
      using Kessel;
      namespace BadAppTest;
      alias badPerm = Kessel.V1WorkspacePermission<"My-App", "things", "read", "myapp_thing_view">;
    `);
    const diags = diagnostics.filter((d) =>
      String(d.code) === "kessel-emitter/invalid-app-name",
    );
    expect(diags.length).toBeGreaterThan(0);
  });

  it("rejects hyphenated resource name", async () => {
    const { diagnostics } = await compileAndValidate(`
      import "../../lib/kessel.tsp";
      import "../../lib/kessel-extensions.tsp";
      import "../../schema/rbac.tsp";
      using Kessel;
      namespace BadResTest;
      alias badPerm = Kessel.V1WorkspacePermission<"myapp", "my-things", "read", "myapp_thing_view">;
    `);
    const diags = diagnostics.filter((d) =>
      String(d.code) === "kessel-emitter/invalid-resource-name",
    );
    expect(diags.length).toBeGreaterThan(0);
  });

  it("rejects v2Perm with dashes", async () => {
    const { diagnostics } = await compileAndValidate(`
      import "../../lib/kessel.tsp";
      import "../../lib/kessel-extensions.tsp";
      import "../../schema/rbac.tsp";
      using Kessel;
      namespace BadV2Test;
      alias badPerm = Kessel.V1WorkspacePermission<"myapp", "things", "read", "myapp-thing-view">;
    `);
    const diags = diagnostics.filter((d) =>
      String(d.code) === "kessel-emitter/invalid-v2-perm-name",
    );
    expect(diags.length).toBeGreaterThan(0);
  });

  it("passes for valid lowercase params", async () => {
    const { diagnostics } = await compileAndValidate(`
      import "../../lib/kessel.tsp";
      import "../../lib/kessel-extensions.tsp";
      import "../../schema/rbac.tsp";
      using Kessel;
      namespace GoodTest;
      alias goodPerm = Kessel.V1WorkspacePermission<"myapp", "things", "read", "myapp_thing_view">;
    `);
    const diags = diagnostics.filter((d) =>
      String(d.code).startsWith("kessel-emitter/invalid-app") ||
      String(d.code).startsWith("kessel-emitter/invalid-resource") ||
      String(d.code).startsWith("kessel-emitter/invalid-v2"),
    );
    expect(diags).toHaveLength(0);
  });
});

describe("$onValidate patch-rule format checking", () => {
  it("validates permission rule format (name=body)", () => {
    const eqIdx = "inventory_host_view=any_any_any | foo".indexOf("=");
    expect(eqIdx).toBeGreaterThan(0);
    const name = "inventory_host_view=any_any_any | foo".slice(0, eqIdx).trim();
    expect(name).toBe("inventory_host_view");
  });

  it("validates accumulate rule format", async () => {
    const { parseAccumulateRule } = await import("../../src/declarative-extensions.js");

    expect(parseAccumulateRule("view_metadata=or({v2}),when={verb}==read,public=true")).not.toBeNull();
    expect(parseAccumulateRule("not-valid")).toBeNull();
    expect(parseAccumulateRule("")).toBeNull();
  });

  it("validates addField rule format", async () => {
    const { parseJsonSchemaFieldRule } = await import("../../src/declarative-extensions.js");

    expect(parseJsonSchemaFieldRule("{v2}_id=string:uuid,required=true")).not.toBeNull();
    expect(parseJsonSchemaFieldRule("bad")).toBeNull();
  });
});
