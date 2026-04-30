// Kessel Schema Emitter
// Single entry point: compiles TypeSpec, discovers resources and permissions,
// validates safety constraints, expands V1 permissions, and emits the requested output format.
//
// Usage: npx tsx src/spicedb-emitter.ts [schema/main.tsp] [--metadata] [--ir [outpath]] [--unified-jsonschema] [--preview <v2perm>]

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile, NodeHost } from "@typespec/compiler";
import { discoverResources } from "./discover.js";
import {
  generateSpiceDB,
  generateMetadata,
  generateUnifiedJsonSchemas,
  generateIR,
} from "./generate.js";
import { bodyToZed } from "./utils.js";
import {
  discoverV1Permissions,
  discoverAnnotations,
  discoverCascadeDeletePolicies,
  expandV1Permissions,
  expandCascadeDeletePolicies,
} from "./expand.js";
import {
  validateComplexityBudget,
  withExpansionTimeout,
  validateOutputSize,
  validatePermissionExpressions,
} from "./safety.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const mainFile = args.find((a) => !a.startsWith("--")) ||
    path.resolve(__dirname, "../schema/main.tsp");
  const resolvedMain = path.resolve(mainFile);

  console.error(`Compiling ${resolvedMain}...`);

  // Step 1: Compile
  const program = await compile(NodeHost, resolvedMain, { noEmit: true });
  const hasErrors = program.diagnostics.some((d) => d.severity === "error");
  if (hasErrors) {
    const msgs = program.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
    throw new Error(`Compilation failed:\n${msgs.join("\n")}`);
  }

  // Step 2: Discover
  const { resources } = discoverResources(program);
  const permissions = discoverV1Permissions(program);
  const annotations = discoverAnnotations(program);
  const cascadePolicies = discoverCascadeDeletePolicies(program);

  // Safety: validate complexity budget before expansion
  validateComplexityBudget(permissions);

  // Step 3: Expand (with timeout guard)
  const fullSchema = withExpansionTimeout(() => {
    const expanded = expandV1Permissions(resources, permissions);
    return expandCascadeDeletePolicies(expanded, cascadePolicies);
  });

  // Safety: validate permission expressions after expansion
  const diagnostics = validatePermissionExpressions(fullSchema);
  if (diagnostics.length > 0) {
    console.error(`\n⚠ Permission expression validation found ${diagnostics.length} issue(s):`);
    for (const d of diagnostics) {
      console.error(`  ${d.resource}.${d.relation}: ${d.message}`);
    }
    console.error("");
    if (!args.includes("--no-strict")) {
      process.exit(1);
    }
  }

  console.error(
    `Discovered ${resources.length} resources, ${permissions.length} V1 extensions, expanded to ${fullSchema.length} resource defs.`,
  );

  // Step 4: Generate and emit
  if (args.includes("--preview")) {
    const previewIdx = args.indexOf("--preview");
    const targetPerm = args[previewIdx + 1];
    if (!targetPerm || targetPerm.startsWith("--")) {
      console.error("Usage: --preview <v2_permission_name>");
      console.error("Available permissions:");
      for (const p of permissions) {
        console.error(`  ${p.v2Perm}  (${p.application}:${p.resource}:${p.verb})`);
      }
      process.exit(1);
    }

    const ext = permissions.find((p) => p.v2Perm === targetPerm);
    if (!ext) {
      console.error(`No extension found for v2 permission "${targetPerm}".`);
      console.error("Available permissions:");
      for (const p of permissions) {
        console.error(`  ${p.v2Perm}  (${p.application}:${p.resource}:${p.verb})`);
      }
      throw new Error(`No extension found for v2 permission "${targetPerm}".`);
    }

    const { application: app, resource: res, verb, v2Perm: v2 } = ext;
    console.log(`Preview: V1WorkspacePermission<"${app}", "${res}", "${verb}", "${v2}">`);
    console.log(`Source: ${app}:${res}:${verb} → ${v2}\n`);
    console.log("Mutations applied to RBAC types:\n");

    console.log("  1. rbac/role — add bool relations:");
    console.log(`       ${app}_any_any, ${app}_${res}_any, ${app}_any_${verb}, ${app}_${res}_${verb}`);

    console.log(`\n  2. rbac/role — add computed permission:`);
    console.log(`       permission ${v2} = any_any_any + ${app}_any_any + ${app}_${res}_any + ${app}_any_${verb} + ${app}_${res}_${verb}`);

    console.log(`\n  3. rbac/role_binding — add intersection permission:`);
    console.log(`       permission ${v2} = (subject & t_granted->${v2})`);

    console.log(`\n  4. rbac/workspace — add union permission:`);
    console.log(`       permission ${v2} = t_binding->${v2} + t_parent->${v2}`);

    if (verb === "read") {
      console.log(`\n  5. rbac/workspace — accumulate into view_metadata:`);
      console.log(`       permission view_metadata = ... + ${v2}`);
    }

    console.log(`\nExpanded SpiceDB for this permission:\n`);
    const role = fullSchema.find((r) => r.name === "role" && r.namespace === "rbac");
    const rb = fullSchema.find((r) => r.name === "role_binding" && r.namespace === "rbac");
    const ws = fullSchema.find((r) => r.name === "workspace" && r.namespace === "rbac");
    for (const [label, resourceDef] of [["rbac/role", role], ["rbac/role_binding", rb], ["rbac/workspace", ws]] as const) {
      if (!resourceDef) continue;
      const matching = resourceDef.relations.filter((r) => r.name === v2 || r.name === `${app}_${res}_${verb}` || r.name === `${app}_any_any` || r.name === `${app}_${res}_any` || r.name === `${app}_any_${verb}`);
      if (matching.length > 0) {
        console.log(`  ${label}:`);
        for (const rel of matching) {
          const isAssignable = rel.body.kind === "assignable" || rel.body.kind === "bool";
          if (isAssignable) {
            console.log(`    relation t_${rel.name}: ${bodyToZed(rel.body)}`);
            console.log(`    permission ${rel.name} = t_${rel.name}`);
          } else {
            console.log(`    permission ${rel.name} = ${bodyToZed(rel.body)}`);
          }
        }
      }
    }
  } else if (args.includes("--ir")) {
    const irIndex = args.indexOf("--ir");
    const nextArg = args[irIndex + 1];
    const outPath = nextArg && !nextArg.startsWith("--")
      ? nextArg
      : path.resolve(__dirname, "../go-loader-example/schema/resources.json");
    const ir = generateIR(resolvedMain, fullSchema, permissions, annotations);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(ir, null, 2) + "\n");
    console.error(`Wrote IR to ${outPath}`);
  } else if (args.includes("--metadata")) {
    console.log(JSON.stringify(generateMetadata(fullSchema, permissions), null, 2));
  } else if (args.includes("--unified-jsonschema")) {
    console.log(JSON.stringify(generateUnifiedJsonSchemas(fullSchema), null, 2));
  } else {
    const spicedb = generateSpiceDB(fullSchema);

    // Safety: validate output size
    const sizeResult = validateOutputSize(spicedb);
    if (sizeResult.warning) {
      console.error(`⚠ ${sizeResult.warning}`);
    }

    console.log("// Generated SpiceDB/Zed Schema from TypeSpec type graph");
    console.log("// Produced by walking the compiled TypeSpec program.");
    console.log("");
    console.log(spicedb);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
