import type { Program, Model, Type } from "@typespec/compiler";
import { navigateProgram, isTemplateInstance } from "@typespec/compiler";
import { $lib } from "./lib-definition.js";
import {
  findV1PermissionTemplate,
  isInstanceOf,
  getNamespaceFQN,
} from "./lib.js";
import {
  parseAccumulateRule,
  parseJsonSchemaFieldRule,
} from "./declarative-extensions.js";

const PARAM_NAMES = new Set(["application", "resource", "verb", "v2Perm"]);
const PATCH_TARGETS = new Set(["role", "roleBinding", "workspace", "jsonSchema"]);
const PATCH_TYPES = new Set(["boolRelations", "permission", "public", "accumulate", "addField"]);
const VALID_PLACEHOLDERS = /\{(app|res|verb|v2)\}/g;
const ANY_PLACEHOLDER = /\{[^}]+\}/g;

const LOWERCASE_ALPHA = /^[a-z][a-z0-9]*$/;
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

function getStringValue(t: Type): string | undefined {
  if ("value" in t && typeof (t as any).value === "string") {
    return (t as any).value;
  }
  if (t.kind === "Scalar" && t.name) return t.name;
  return undefined;
}

function hasUnknownPlaceholders(value: string): boolean {
  const withoutKnown = value.replace(VALID_PLACEHOLDERS, "");
  return ANY_PLACEHOLDER.test(withoutKnown);
}

function validateBoolRelations(value: string): boolean {
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length > 0;
}

function validatePermissionRule(value: string): boolean {
  const eqIdx = value.indexOf("=");
  if (eqIdx === -1) return false;
  const name = value.slice(0, eqIdx).trim();
  const body = value.slice(eqIdx + 1).trim();
  return name.length > 0 && body.length > 0;
}

export function $onValidate(program: Program) {
  const template = findV1PermissionTemplate(program);
  if (!template) return;

  navigateProgram(program, {
    model(model: Model) {
      if (model.templateNode && !isTemplateInstance(model)) return;
      if (getNamespaceFQN(model.namespace).endsWith("Kessel")) {
        validateTemplateProperties(program, model);
        return;
      }
      if (!isInstanceOf(model, template)) return;
      validateInstanceProperties(program, model);
    },
  });

  for (const [, sourceFile] of program.sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (!("value" in statement && "id" in statement)) continue;
      try {
        const aliasType = program.checker.getTypeForNode(statement);
        if (!aliasType || aliasType.kind !== "Model") continue;
        if (!isInstanceOf(aliasType as Model, template)) continue;
        validateInstanceProperties(program, aliasType as Model);
      } catch {
        // skip statements that can't be resolved
      }
    }
  }
}

function validateTemplateProperties(program: Program, model: Model) {
  if (model.name !== "V1WorkspacePermission") return;

  for (const [name] of model.properties) {
    if (PARAM_NAMES.has(name)) continue;

    const separatorIdx = name.indexOf("_");
    if (separatorIdx === -1) continue;

    const target = name.slice(0, separatorIdx);
    const patchType = name.slice(separatorIdx + 1);

    if (!PATCH_TARGETS.has(target)) {
      $lib.reportDiagnostic(program, {
        code: "invalid-patch-target",
        target: model.properties.get(name)!,
      });
    }

    if (PATCH_TARGETS.has(target) && !PATCH_TYPES.has(patchType)) {
      $lib.reportDiagnostic(program, {
        code: "invalid-patch-type",
        target: model.properties.get(name)!,
      });
    }
  }
}

function validateParamValues(program: Program, model: Model) {
  const appProp = model.properties.get("application");
  if (appProp) {
    const v = getStringValue(appProp.type);
    if (v && !LOWERCASE_ALPHA.test(v)) {
      $lib.reportDiagnostic(program, { code: "invalid-app-name", target: appProp });
    }
  }

  const resProp = model.properties.get("resource");
  if (resProp) {
    const v = getStringValue(resProp.type);
    if (v && !LOWERCASE_ALPHA.test(v)) {
      $lib.reportDiagnostic(program, { code: "invalid-resource-name", target: resProp });
    }
  }

  const v2Prop = model.properties.get("v2Perm");
  if (v2Prop) {
    const v = getStringValue(v2Prop.type);
    if (v && !SNAKE_CASE.test(v)) {
      $lib.reportDiagnostic(program, { code: "invalid-v2-perm-name", target: v2Prop });
    }
  }
}

function validateInstanceProperties(program: Program, model: Model) {
  validateParamValues(program, model);

  for (const [name, prop] of model.properties) {
    if (PARAM_NAMES.has(name)) continue;

    const separatorIdx = name.indexOf("_");
    if (separatorIdx === -1) continue;

    const target = name.slice(0, separatorIdx);
    const patchType = name.slice(separatorIdx + 1);

    if (!PATCH_TARGETS.has(target)) continue;

    const value = getStringValue(prop.type);
    if (!value) continue;

    if (hasUnknownPlaceholders(value)) {
      $lib.reportDiagnostic(program, {
        code: "invalid-placeholder",
        target: prop,
      });
    }

    switch (patchType) {
      case "boolRelations":
        if (!validateBoolRelations(value)) {
          $lib.reportDiagnostic(program, {
            code: "invalid-bool-relations",
            target: prop,
          });
        }
        break;

      case "permission":
        if (!validatePermissionRule(value)) {
          $lib.reportDiagnostic(program, {
            code: "invalid-permission-rule",
            target: prop,
          });
        }
        break;

      case "accumulate":
        if (!parseAccumulateRule(value)) {
          $lib.reportDiagnostic(program, {
            code: "invalid-accumulate-rule",
            target: prop,
          });
        }
        break;

      case "addField":
        if (!parseJsonSchemaFieldRule(value)) {
          $lib.reportDiagnostic(program, {
            code: "invalid-add-field-rule",
            target: prop,
          });
        }
        break;

      case "public":
        break;

      default:
        $lib.reportDiagnostic(program, {
          code: "invalid-patch-type",
          target: prop,
        });
        break;
    }
  }
}
