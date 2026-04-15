import { createTypeSpecLibrary, type JSONSchemaType } from "@typespec/compiler";

export interface KesselEmitterOptions {
  "output-format"?: "spicedb" | "ir" | "metadata" | "unified-jsonschema" | "preview";
  "ir-output-path"?: string;
  "lenient-extensions"?: boolean;
}

const EmitterOptionsSchema: JSONSchemaType<KesselEmitterOptions> = {
  type: "object",
  additionalProperties: false,
  properties: {
    "output-format": {
      type: "string",
      enum: ["spicedb", "ir", "metadata", "unified-jsonschema", "preview"],
      nullable: true,
    },
    "ir-output-path": {
      type: "string",
      nullable: true,
    },
    "lenient-extensions": {
      type: "boolean",
      nullable: true,
    },
  },
  required: [],
};

export const $lib = createTypeSpecLibrary({
  name: "kessel-emitter",
  diagnostics: {
    "invalid-patch-target": {
      severity: "error",
      messages: {
        default: `Patch-rule property name must start with a known target (role, roleBinding, workspace, jsonSchema) followed by underscore and patch type.`,
      },
    },
    "invalid-patch-type": {
      severity: "error",
      messages: {
        default: `Unknown patch type. Expected one of: boolRelations, permission, public, accumulate, addField.`,
      },
    },
    "invalid-bool-relations": {
      severity: "error",
      messages: {
        default: `boolRelations value must be a non-empty comma-separated list of names (may include {app}, {res}, {verb}, {v2} placeholders).`,
      },
    },
    "invalid-permission-rule": {
      severity: "error",
      messages: {
        default: `permission value must match "name=body" where body uses | for union, & for intersect, -> for subreference.`,
      },
    },
    "invalid-accumulate-rule": {
      severity: "error",
      messages: {
        default: `accumulate value must match "name=op(ref),when=condition,public=bool".`,
      },
    },
    "invalid-add-field-rule": {
      severity: "error",
      messages: {
        default: `addField value must match "name=type:format,required=bool".`,
      },
    },
    "invalid-placeholder": {
      severity: "warning",
      messages: {
        default: `Patch-rule string contains an unrecognized placeholder. Valid placeholders: {app}, {res}, {verb}, {v2}.`,
      },
    },
    "invalid-app-name": {
      severity: "error",
      messages: {
        default: `Application name must be lowercase alphanumeric (a-z, 0-9). Example: "inventory".`,
      },
    },
    "invalid-resource-name": {
      severity: "error",
      messages: {
        default: `Resource name must be lowercase alphanumeric (a-z, 0-9). Example: "hosts".`,
      },
    },
    "invalid-v2-perm-name": {
      severity: "error",
      messages: {
        default: `v2 permission name must be lowercase snake_case (a-z, 0-9, _). Example: "inventory_host_view".`,
      },
    },
  },
  emitter: {
    options: EmitterOptionsSchema,
  },
} as const);
