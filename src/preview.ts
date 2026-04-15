import type { DeclaredExtension } from "./declarative-extensions.js";
import {
  interpolate,
  parseAccumulateRule,
  parseJsonSchemaFieldRule,
} from "./declarative-extensions.js";

interface PatchEffect {
  target: string;
  description: string;
}

function previewExtension(ext: DeclaredExtension): PatchEffect[] {
  const effects: PatchEffect[] = [];
  const p = ext.params;

  for (const rule of ext.patchRules) {
    const value = interpolate(rule.rawValue, p);

    switch (rule.patchType) {
      case "boolRelations": {
        const names = value.split(",").map((n) => n.trim()).filter(Boolean);
        effects.push({
          target: `rbac/${rule.target}`,
          description: `+${names.length} bool relation${names.length !== 1 ? "s" : ""}: ${names.join(", ")}`,
        });
        break;
      }

      case "permission": {
        const eqIdx = value.indexOf("=");
        if (eqIdx > 0) {
          const name = value.slice(0, eqIdx);
          const body = value.slice(eqIdx + 1).trim();
          const opCount = (body.match(/ [|&] /g) || []).length;
          const hasArrow = body.includes("->");
          let kind = "computed";
          if (body.includes(" & ")) kind = "intersect";
          else if (body.includes(" | ") || body.includes(" + ")) kind = "union";
          if (hasArrow) kind += " (delegated)";
          effects.push({
            target: `rbac/${rule.target}`,
            description: `+1 ${kind} permission: ${name}`,
          });
        }
        break;
      }

      case "public": {
        const names = value.split(",").map((n) => n.trim()).filter(Boolean);
        effects.push({
          target: `rbac/${rule.target}`,
          description: `mark public: ${names.join(", ")}`,
        });
        break;
      }

      case "accumulate": {
        const parsed = parseAccumulateRule(rule.rawValue);
        if (parsed) {
          const ref = interpolate(parsed.ref, p);
          let condStr = "";
          if (parsed.condition) {
            const paramLabel = parsed.condition.param.replace(/^\{|\}$/g, "");
            condStr = ` (when ${paramLabel}==${parsed.condition.value})`;
          }
          effects.push({
            target: `rbac/${rule.target}`,
            description: `contributes ${ref} to ${parsed.name}${condStr}`,
          });
        }
        break;
      }

      case "addField": {
        const parsed = parseJsonSchemaFieldRule(value);
        if (parsed) {
          const fmt = parsed.format ? `:${parsed.format}` : "";
          const req = parsed.required ? ", required" : "";
          effects.push({
            target: "json_schema",
            description: `+${parsed.fieldName} (${parsed.fieldType}${fmt}${req})`,
          });
        }
        break;
      }
    }
  }

  return effects;
}

export function generatePreview(extensions: DeclaredExtension[]): string {
  if (extensions.length === 0) return "No V1WorkspacePermission extensions found.\n";

  const lines: string[] = [];

  for (const ext of extensions) {
    const p = ext.params;
    const aliasLabel = `${p.application}/${p.resource}/${p.verb}`;
    lines.push(`${p.v2Perm} (${aliasLabel}):`);

    const effects = previewExtension(ext);
    const grouped = new Map<string, string[]>();
    for (const e of effects) {
      if (!grouped.has(e.target)) grouped.set(e.target, []);
      grouped.get(e.target)!.push(e.description);
    }

    for (const [target, descs] of grouped) {
      const pad = "  ";
      for (const d of descs) {
        lines.push(`${pad}${target}: ${d}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}
