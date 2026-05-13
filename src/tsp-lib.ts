import { createTypeSpecLibrary } from "@typespec/compiler";

export const $lib = createTypeSpecLibrary({
  name: "typespec-as-schema",
  diagnostics: {},
  state: {
    provider: { description: "Extension provider metadata attached via @provider decorator" },
    annotation: { description: "Resource annotation key/value pairs attached via @annotation decorator" },
    cascadeDelete: { description: "Cascade-delete parent relation attached via @cascadeDelete decorator" },
  },
});

export const { stateKeys: KesselStateKeys } = $lib;
