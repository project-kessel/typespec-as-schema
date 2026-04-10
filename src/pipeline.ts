// Single expansion pipeline: declarative extension patches → enriched ResourceDef[].

import type { Program } from "@typespec/compiler";
import type { ResourceDef, JsonSchemaExtraField } from "./lib.js";
import { discoverDeclaredExtensions, applyDeclaredPatches } from "./declarative-extensions.js";

export function expandSchemaWithExtensions(
  program: Program,
  resources: ResourceDef[],
): { fullSchema: ResourceDef[]; jsonSchemaFields: JsonSchemaExtraField[] } {
  const declared = discoverDeclaredExtensions(program);
  const { resources: fullSchema, jsonSchemaFields } = applyDeclaredPatches(
    resources,
    declared,
  );
  return { fullSchema, jsonSchemaFields };
}
