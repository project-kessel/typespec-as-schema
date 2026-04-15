// Single expansion pipeline: declarative extension patches → enriched ResourceDef[].

import type { Program } from "@typespec/compiler";
import type { ResourceDef, JsonSchemaExtraField } from "./lib.js";
import {
  discoverV1WorkspacePermissionDeclarations,
  applyDeclaredPatches,
  type ApplyDeclaredPatchesOptions,
} from "./declarative-extensions.js";

export function expandSchemaWithExtensions(
  program: Program,
  resources: ResourceDef[],
  patchOptions?: ApplyDeclaredPatchesOptions,
): { fullSchema: ResourceDef[]; jsonSchemaFields: JsonSchemaExtraField[] } {
  const declared = discoverV1WorkspacePermissionDeclarations(program);
  const { resources: fullSchema, jsonSchemaFields } = applyDeclaredPatches(
    resources,
    declared,
    patchOptions,
  );
  return { fullSchema, jsonSchemaFields };
}
