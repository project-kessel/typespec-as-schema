import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile, NodeHost, type Program, type Model } from "@typespec/compiler";
import { buildRegistry, type ExtensionTemplateDef } from "../../src/registry.js";
import { findExtensionTemplate } from "../../src/discover-extensions.js";
import { getNamespaceFQN } from "../../src/utils.js";
import { rbacProvider } from "../../schema/rbac/rbac-provider.js";
import { enrichProvidersFromDecorators } from "../../src/decorator-reader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainEntrypoint = path.resolve(__dirname, "../../schema/main.tsp");

let program: Program;
let ALL_TEMPLATES: ExtensionTemplateDef[];

beforeAll(async () => {
  program = await compile(NodeHost, mainEntrypoint, { noEmit: true });
  const errors = program.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Schema compilation failed:\n${errors.map((d) => d.message).join("\n")}`);
  }
  enrichProvidersFromDecorators(program, [rbacProvider]);
  const registry = buildRegistry([rbacProvider]);
  ALL_TEMPLATES = registry.templates;
}, 30_000);

describe("Registry-TSP contract", () => {
  it("every registry template exists as a model in the expected namespace", () => {
    for (const def of ALL_TEMPLATES) {
      const model = findExtensionTemplate(program, def.templateName, def.namespace);
      expect(model, `Template "${def.templateName}" not found in compiled program`).not.toBeNull();
      const fqn = getNamespaceFQN(model!.namespace);
      expect(
        fqn.endsWith(def.namespace),
        `Template "${def.templateName}" namespace "${fqn}" does not end with "${def.namespace}"`,
      ).toBe(true);
    }
  });

  it("every paramName in the registry matches a property on the TSP model", () => {
    for (const def of ALL_TEMPLATES) {
      const model = findExtensionTemplate(program, def.templateName, def.namespace) as Model;
      expect(model).not.toBeNull();

      const modelPropNames = [...model.properties.keys()];
      for (const paramName of def.paramNames) {
        expect(
          modelPropNames,
          `Property "${paramName}" missing from TSP model "${def.templateName}" (has: ${modelPropNames.join(", ")})`,
        ).toContain(paramName);
      }
    }
  });

  it("RBAC provider's valid verbs matches expected set", async () => {
    const { VALID_VERBS } = await import("../../schema/rbac/rbac-provider.js");
    const expectedVerbs = new Set(["read", "write", "create", "delete"]);
    expect(VALID_VERBS).toEqual(expectedVerbs);
  });

  it("warns on duplicate template names across providers", () => {
    const sharedTemplate = { templateName: "V1WorkspacePermission", paramNames: ["application", "resource", "verb", "v2Perm"], namespace: "Kessel" };
    const providerA = {
      id: "provA",
      templates: [sharedTemplate],
      discover: () => [],
      expand: (r: any) => ({ resources: r, warnings: [] }),
    };
    const providerB = {
      id: "provB",
      templates: [sharedTemplate],
      discover: () => [],
      expand: (r: any) => ({ resources: r, warnings: [] }),
    };
    const { warnings } = buildRegistry([providerA, providerB]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("Duplicate template");
    expect(warnings[0]).toContain("V1WorkspacePermission");
  });

  it("no extra properties on TSP models that are missing from registry paramNames", () => {
    for (const def of ALL_TEMPLATES) {
      const model = findExtensionTemplate(program, def.templateName, def.namespace) as Model;
      expect(model).not.toBeNull();

      const modelPropNames = [...model.properties.keys()];
      for (const prop of modelPropNames) {
        expect(
          def.paramNames,
          `TSP model "${def.templateName}" has property "${prop}" not listed in registry paramNames`,
        ).toContain(prop);
      }
    }
  });
});
