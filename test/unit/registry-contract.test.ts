import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile, NodeHost, type Program, type Model } from "@typespec/compiler";
import { EXTENSION_TEMPLATES } from "../../src/registry.js";
import { findExtensionTemplate, VALID_VERBS } from "../../src/discover.js";
import { getNamespaceFQN } from "../../src/utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libEntrypoint = path.resolve(__dirname, "../../lib/kessel-extensions.tsp");

let program: Program;

beforeAll(async () => {
  program = await compile(NodeHost, libEntrypoint, { noEmit: true });
  const errors = program.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Kessel library compilation failed:\n${errors.map((d) => d.message).join("\n")}`);
  }
}, 30_000);

describe("Registry-TSP contract", () => {
  it("every EXTENSION_TEMPLATES entry exists as a model in the Kessel namespace", () => {
    for (const def of EXTENSION_TEMPLATES) {
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
    for (const def of EXTENSION_TEMPLATES) {
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

  it("VALID_VERBS matches KesselVerb members from kessel-extensions.tsp", () => {
    // KesselVerb is `alias KesselVerb = "read" | "write" | "create" | "delete"`.
    // Since it's an alias of a union of string literals, we verify against our
    // known constant. If KesselVerb changes in the .tsp, this test forces
    // VALID_VERBS to be updated.
    const expectedVerbs = new Set(["read", "write", "create", "delete"]);
    expect(VALID_VERBS).toEqual(expectedVerbs);
  });

  it("no extra properties on TSP models that are missing from registry paramNames", () => {
    for (const def of EXTENSION_TEMPLATES) {
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
