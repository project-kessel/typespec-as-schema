// SpiceDB/Zed Schema Emitter for TypeSpec
// Walks the compiled TypeSpec type graph to produce SpiceDB schema output.
// Uses the TypeSpec compiler API to discover models, relations, and permissions.
//
// Usage: npx tsx emitter/spicedb-emitter.ts [main.tsp]

import {
  compile,
  NodeHost,
  navigateProgram,
  type Program,
  type Model,
  type ModelProperty,
  type Namespace,
  type Type,
  isTemplateInstance,
} from "@typespec/compiler";
import * as path from "path";

interface RelationDef {
  name: string;
  body: RelationBody;
  isPublic?: boolean;
}

type RelationBody =
  | { kind: "assignable"; target: string; cardinality: string }
  | { kind: "bool"; target: string }
  | { kind: "ref"; name: string }
  | { kind: "subref"; name: string; subname: string }
  | { kind: "or"; members: RelationBody[] }
  | { kind: "and"; members: RelationBody[] };

interface ResourceDef {
  name: string;
  namespace: string;
  relations: RelationDef[];
}

function getNamespaceFQN(ns: Namespace | undefined): string {
  if (!ns) return "";
  const parts: string[] = [];
  let current: Namespace | undefined = ns;
  while (current && current.name) {
    parts.unshift(current.name);
    current = current.namespace;
  }
  return parts.join(".");
}

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function isKesselType(model: Model, expectedName: string): boolean {
  return model.name === expectedName && getNamespaceFQN(model.namespace).endsWith("Kessel");
}

function getTemplateArg(model: Model, index: number): Type | undefined {
  if (!isTemplateInstance(model)) return undefined;
  return model.templateMapper?.args?.[index] as Type | undefined;
}

function getStringLiteralValue(t: Type | undefined): string | undefined {
  if (!t) return undefined;
  if (t.kind === "Scalar" && "value" in t) return String((t as any).value);
  if (t.kind === "String") return (t as any).value;
  if ((t as any).kind === "StringTemplate") return undefined;
  if ("value" in (t as any)) return String((t as any).value);

  // For template args that are string literal types
  if (t.kind === "Scalar" && t.name) return t.name;
  return undefined;
}

function getEnumMemberName(t: Type | undefined): string | undefined {
  if (!t) return undefined;
  if (t.kind === "EnumMember") return t.name;
  return undefined;
}

interface V1Extension {
  application: string;
  resource: string;
  verb: string;
  v2Perm: string;
}

function extractV1Extension(model: Model): V1Extension | null {
  // Check the model's properties for the string values
  const props: Record<string, string> = {};
  for (const [name, prop] of model.properties) {
    const propType = prop.type;
    if (propType.kind === "Scalar" && propType.name) {
      props[name] = propType.name;
    }
    // String literal types appear differently
    if ("value" in propType) {
      props[name] = String((propType as any).value);
    }
  }

  if (props.application && props.resource && props.verb && props.v2Perm) {
    return {
      application: props.application,
      resource: props.resource,
      verb: props.verb,
      v2Perm: props.v2Perm,
    };
  }
  return null;
}

function discoverResources(program: Program): {
  resources: ResourceDef[];
  extensions: V1Extension[];
} {
  const resources: ResourceDef[] = [];
  const extensions: V1Extension[] = [];
  const seenResources = new Set<string>();
  const seenExtensions = new Set<string>();

  const v1PermTemplate = findV1PermissionTemplate(program);

  // Use navigateProgram to find declared models (not aliases)
  navigateProgram(program, {
    model(model: Model) {
      if (model.templateNode && !isTemplateInstance(model)) return;

      const modelNsFQN = getNamespaceFQN(model.namespace);
      if (modelNsFQN.endsWith("Kessel")) return;

      if (v1PermTemplate && isInstanceOf(model, v1PermTemplate)) {
        const ext = extractV1Extension(model);
        if (ext && !seenExtensions.has(ext.v2Perm)) {
          seenExtensions.add(ext.v2Perm);
          extensions.push(ext);
        }
        return;
      }

      if (model.name.endsWith("Data")) return;
      if (!model.name || model.name === "") return;

      const nsPrefix = modelNsFQN;
      const key = `${nsPrefix}/${model.name}`;
      if (seenResources.has(key)) return;

      const resource = modelToResource(model, nsPrefix);
      if (resource) {
        seenResources.add(key);
        resources.push(resource);
      }
    },
  });

  // Discover alias-instantiated V1BasedPermission via source file AST walk.
  // Aliases don't appear in namespace.models — they're only in the AST.
  for (const [, sourceFile] of program.sourceFiles) {
    for (const statement of sourceFile.statements) {
      // TypeSpec AliasStatement nodes have an `id` and `value` property
      if ("value" in statement && "id" in statement) {
        try {
          const aliasType = program.checker.getTypeForNode(statement);
          if (aliasType && aliasType.kind === "Model" && v1PermTemplate) {
            if (isInstanceOf(aliasType, v1PermTemplate)) {
              const ext = extractV1Extension(aliasType);
              if (ext && !seenExtensions.has(ext.v2Perm)) {
                seenExtensions.add(ext.v2Perm);
                extensions.push(ext);
              }
            }
          }
        } catch {
          // Skip nodes that can't be resolved
        }
      }
    }
  }

  return { resources, extensions };
}

function findV1PermissionTemplate(program: Program): Model | null {
  const globalNs = program.getGlobalNamespaceType();
  function search(ns: Namespace): Model | null {
    for (const [, model] of ns.models) {
      if (model.name === "V1BasedPermission") return model;
    }
    for (const [, childNs] of ns.namespaces) {
      const found = search(childNs);
      if (found) return found;
    }
    return null;
  }
  return search(globalNs);
}

function isInstanceOf(model: Model, template: Model): boolean {
  if (!isTemplateInstance(model)) return false;
  if (model.sourceModel === template) return true;
  if (model.templateNode === template.node) return true;
  // Fallback: check name and namespace match
  if (
    model.name === template.name &&
    getNamespaceFQN(model.namespace) === getNamespaceFQN(template.namespace)
  ) {
    return true;
  }
  return false;
}

function modelToResource(
  model: Model,
  nsPrefix: string
): ResourceDef | null {
  const relations: RelationDef[] = [];
  let hasRelations = false;

  for (const [name, prop] of model.properties) {
    if (name === "data") continue;

    const propType = prop.type;
    if (propType.kind !== "Model") continue;

    if (isKesselType(propType, "Assignable")) {
      hasRelations = true;
      const targetArg = getTemplateArg(propType, 0);
      const cardArg = getTemplateArg(propType, 1);
      const target = resolveTargetName(targetArg);
      const cardinality = getEnumMemberName(cardArg) ?? "Any";
      relations.push({
        name,
        body: { kind: "assignable", target, cardinality },
      });
    } else if (isKesselType(propType, "BoolRelation")) {
      hasRelations = true;
      const targetArg = getTemplateArg(propType, 0);
      const target = resolveTargetName(targetArg);
      relations.push({
        name,
        body: { kind: "bool", target },
      });
    } else if (isKesselType(propType, "Permission")) {
      hasRelations = true;
      // Permission<Expr> — the expression is a string template argument
      const exprProp = propType.properties.get("__expr");
      let expr = "";
      if (exprProp) {
        const exprType = exprProp.type;
        if (exprType.kind === "Scalar" && exprType.name) {
          expr = exprType.name;
        } else if ("value" in exprType) {
          expr = String((exprType as any).value);
        }
      }
      const parsed = parsePermissionExpr(expr);
      if (parsed) {
        relations.push({ name, body: parsed });
      }
    }
  }

  if (!hasRelations) return null;

  const nsName = nsPrefix.toLowerCase().replace(/\./g, "/");
  return {
    name: camelToSnake(model.name),
    namespace: nsName || getNamespaceFQN(model.namespace)?.toLowerCase() || "unknown",
    relations,
  };
}

function resolveTargetName(t: Type | undefined): string {
  if (!t) return "unknown";
  if (t.kind === "Model") {
    const ns = getNamespaceFQN(t.namespace)?.toLowerCase() || "";
    return ns ? `${ns}/${camelToSnake(t.name)}` : camelToSnake(t.name);
  }
  return "unknown";
}

function parsePermissionExpr(expr: string): RelationBody | null {
  if (!expr) return null;

  // Handle dotted references: "workspace.inventory_host_view"
  if (expr.includes(".") && !expr.includes(" ")) {
    const [name, subname] = expr.split(".");
    return { kind: "subref", name, subname };
  }

  // Handle OR expressions: "all_all_all | inventory_all_all | ..."
  if (expr.includes(" | ") || expr.includes(" + ")) {
    const sep = expr.includes(" | ") ? " | " : " + ";
    const members = expr.split(sep).map((m) => m.trim());
    return {
      kind: "or",
      members: members.map((m) => {
        if (m.includes("->")) {
          const [name, subname] = m.split("->");
          return { kind: "subref" as const, name, subname };
        }
        return { kind: "ref" as const, name: m };
      }),
    };
  }

  // Handle AND expressions: "subject & granted->inventory_host_view"
  if (expr.includes(" & ")) {
    const members = expr.split(" & ").map((m) => m.trim());
    return {
      kind: "and",
      members: members.map((m) => {
        if (m.includes("->")) {
          const [name, subname] = m.split("->");
          return { kind: "subref" as const, name, subname };
        }
        return { kind: "ref" as const, name: m };
      }),
    };
  }

  // Simple reference
  return { kind: "ref", name: expr };
}

function buildSchemaFromTypeGraph(
  resources: ResourceDef[],
  extensions: V1Extension[]
): ResourceDef[] {
  // Collect extra relations from extensions onto RBAC types
  const roleExtraRelations: RelationDef[] = [];
  const roleBindingExtraRelations: RelationDef[] = [];
  const workspaceExtraRelations: RelationDef[] = [];
  const addedBoolPerms = new Set<string>();

  for (const ext of extensions) {
    const appAdmin = `${ext.application}_all_all`;
    const anyVerb = `${ext.application}_${ext.resource}_all`;
    const anyResource = `${ext.application}_all_${ext.verb}`;
    const v1Perm = `${ext.application}_${ext.resource}_${ext.verb}`;

    for (const perm of [appAdmin, anyVerb, anyResource, v1Perm]) {
      if (!addedBoolPerms.has(perm)) {
        addedBoolPerms.add(perm);
        roleExtraRelations.push({
          name: perm,
          body: { kind: "bool", target: "rbac/principal" },
        });
      }
    }

    roleExtraRelations.push({
      name: ext.v2Perm,
      body: {
        kind: "or",
        members: [
          { kind: "ref", name: "all_all_all" },
          { kind: "ref", name: appAdmin },
          { kind: "ref", name: anyVerb },
          { kind: "ref", name: anyResource },
          { kind: "ref", name: v1Perm },
        ],
      },
    });

    roleBindingExtraRelations.push({
      name: ext.v2Perm,
      body: {
        kind: "and",
        members: [
          { kind: "ref", name: "subject" },
          { kind: "subref", name: "granted", subname: ext.v2Perm },
        ],
      },
    });

    workspaceExtraRelations.push({
      name: ext.v2Perm,
      body: {
        kind: "or",
        members: [
          { kind: "subref", name: "user_grant", subname: ext.v2Perm },
          { kind: "subref", name: "parent", subname: ext.v2Perm },
        ],
      },
      isPublic: true,
    });
  }

  // Merge extra relations into discovered resources
  const result: ResourceDef[] = [];
  for (const res of resources) {
    const merged = { ...res, relations: [...res.relations] };

    if (res.name === "role" && res.namespace === "rbac") {
      merged.relations.push(...roleExtraRelations);
    }
    if (res.name === "role_binding" && res.namespace === "rbac") {
      merged.relations.push(...roleBindingExtraRelations);
    }
    if (res.name === "workspace" && res.namespace === "rbac") {
      merged.relations.push(...workspaceExtraRelations);
    }

    result.push(merged);
  }

  // Add empty principal if not found
  if (!result.some((r) => r.name === "principal" && r.namespace === "rbac")) {
    result.unshift({ name: "principal", namespace: "rbac", relations: [] });
  }

  return result;
}

// SpiceDB Schema Generator

function bodyToZed(body: RelationBody): string {
  switch (body.kind) {
    case "assignable":
      return `${body.target}`;
    case "bool":
      return `${body.target}:*`;
    case "ref":
      return body.name;
    case "subref":
      return `${body.name}->${body.subname}`;
    case "or":
      return body.members.map(bodyToZed).join(" + ");
    case "and":
      return body.members.map(bodyToZed).join(" & ");
  }
}

function isAssignable(body: RelationBody): boolean {
  return body.kind === "assignable" || body.kind === "bool";
}

function generateSpiceDB(resources: ResourceDef[]): string {
  const lines: string[] = [];

  for (const res of resources) {
    lines.push(`definition ${res.namespace}/${res.name} {`);

    const relations = res.relations.filter((r) => isAssignable(r.body));
    const permissions = res.relations.filter((r) => !isAssignable(r.body));

    for (const rel of relations) {
      lines.push(`    relation ${rel.name}: ${bodyToZed(rel.body)}`);
    }

    if (relations.length > 0 && permissions.length > 0) {
      lines.push("");
    }

    for (const perm of permissions) {
      lines.push(`    permission ${perm.name} = ${bodyToZed(perm.body)}`);
    }

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// Main

async function main() {
  const mainFile = process.argv[2] || path.resolve(__dirname, "../main.tsp");
  const resolvedMain = path.resolve(mainFile);

  console.error(`Compiling ${resolvedMain}...`);

  const program = await compile(NodeHost, resolvedMain, {
    noEmit: true,
  });

  if (program.diagnostics.length > 0) {
    for (const diag of program.diagnostics) {
      const severity = diag.severity === "error" ? "ERROR" : "WARN";
      console.error(`[${severity}] ${diag.message}`);
    }
  }

  const hasErrors = program.diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    console.error("Compilation failed with errors.");
    process.exit(1);
  }

  const { resources, extensions } = discoverResources(program);

  console.error(
    `Discovered ${resources.length} resources and ${extensions.length} V1BasedPermission extensions from type graph.`
  );

  const fullSchema = buildSchemaFromTypeGraph(resources, extensions);
  const output = generateSpiceDB(fullSchema);

  console.log("// Generated SpiceDB/Zed Schema from TypeSpec type graph");
  console.log("// Produced by walking the compiled TypeSpec program.");
  console.log("");
  console.log(output);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
