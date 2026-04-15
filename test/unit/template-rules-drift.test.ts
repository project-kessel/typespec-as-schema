import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile, NodeHost } from "../../src/lib.js";
import {
  readDefaultPatchRulesFromTemplate,
  sortPatchRules,
  V1_WORKSPACE_PERMISSION_TEMPLATE_RULES,
} from "../../src/declarative-extensions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, "../fixtures/kessel-extensions-entry.tsp");

describe("V1WorkspacePermission template vs frozen rules", () => {
  it("kessel-extensions.tsp defaults match V1_WORKSPACE_PERMISSION_TEMPLATE_RULES", async () => {
    const program = await compile(NodeHost, entry, { noEmit: true });
    const fromTsp = readDefaultPatchRulesFromTemplate(program);
    expect(fromTsp.length).toBeGreaterThan(0);

    expect(sortPatchRules(fromTsp)).toEqual(
      sortPatchRules(V1_WORKSPACE_PERMISSION_TEMPLATE_RULES),
    );
  });
});
