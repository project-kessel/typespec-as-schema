// Kessel Schema Emitter
// Single entry point: compiles TypeSpec, discovers resources and permissions,
// validates safety constraints, expands V1 permissions, and emits the requested output format.
//
// Usage: npx tsx src/spicedb-emitter.ts [schema/main.tsp] [--metadata] [--ir [outpath]] [--unified-jsonschema] [--preview <v2perm>] [--annotations] [--no-strict] [--emit-jsonschema] [--watch]

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  generateMetadata,
  generateIR,
} from "./generate.js";
import { bodyToZed, slotName, flattenAnnotations, findResource, isAssignable } from "./utils.js";
import { validateOutputSize } from "./safety.js";
import { compilePipeline } from "./pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function runOnce(args: string[], resolvedMain: string): Promise<void> {
  const emitJsonSchema = args.includes("--emit-jsonschema");

  console.error(`Compiling ${resolvedMain}...`);

  const result = await compilePipeline(resolvedMain, { emitJsonSchema });
  const {
    extensions: permissions,
    annotations,
    cascadePolicies,
    fullSchema,
    diagnostics,
    warnings,
    resources,
  } = result;

  for (const w of warnings) {
    console.error(`Warning: ${w}`);
  }

  if (diagnostics.length > 0) {
    console.error(`\n⚠ Permission expression validation found ${diagnostics.length} issue(s):`);
    for (const d of diagnostics) {
      console.error(`  ${d.resource}.${d.relation}: ${d.message}`);
    }
    console.error("");
    if (!args.includes("--no-strict")) {
      throw new Error("Permission expression validation failed");
    }
  }

  console.error(
    `Discovered ${resources.length} resources, ${permissions.length} V1 extensions, expanded to ${fullSchema.length} resource defs.`,
  );

  if (args.includes("--preview")) {
    const previewIdx = args.indexOf("--preview");
    const targetPerm = args[previewIdx + 1];
    if (!targetPerm || targetPerm.startsWith("--")) {
      const available = permissions.map(p => `  ${p.v2Perm}  (${p.application}:${p.resource}:${p.verb})`).join("\n");
      throw new Error(`Usage: --preview <v2_permission_name>\nAvailable permissions:\n${available}`);
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
    console.log(`       permission ${v2} = (subject & ${slotName("granted")}->${v2})`);

    console.log(`\n  4. rbac/workspace — add union permission:`);
    console.log(`       permission ${v2} = ${slotName("binding")}->${v2} + ${slotName("parent")}->${v2}`);

    if (verb === "read") {
      console.log(`\n  5. rbac/workspace — accumulate into view_metadata:`);
      console.log(`       permission view_metadata = ... + ${v2}`);
    }

    const matchingCascade = cascadePolicies.filter(
      (p) => p.childApplication.toLowerCase() === app,
    );
    for (const cp of matchingCascade) {
      console.log(`\n  + CascadeDeletePolicy: ${cp.childApplication}/${cp.childResource}`);
      console.log(`       permission delete = ${slotName(cp.parentRelation)}->delete`);
    }

    console.log(`\nExpanded SpiceDB for this permission:\n`);
    const role = findResource(fullSchema, "rbac", "role");
    const rb = findResource(fullSchema, "rbac", "role_binding");
    const ws = findResource(fullSchema, "rbac", "workspace");
    for (const [label, resourceDef] of [["rbac/role", role], ["rbac/role_binding", rb], ["rbac/workspace", ws]] as const) {
      if (!resourceDef) continue;
      const matching = resourceDef.relations.filter((r) => r.name === v2 || r.name === `${app}_${res}_${verb}` || r.name === `${app}_any_any` || r.name === `${app}_${res}_any` || r.name === `${app}_any_${verb}`);
      if (matching.length > 0) {
        console.log(`  ${label}:`);
        for (const rel of matching) {
          if (isAssignable(rel.body)) {
            console.log(`    relation ${slotName(rel.name)}: ${bodyToZed(rel.body)}`);
            console.log(`    permission ${rel.name} = ${slotName(rel.name)}`);
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
    const ir = generateIR(resolvedMain, fullSchema, permissions, annotations, cascadePolicies);
    const irJson = JSON.stringify(ir, null, 2) + "\n";
    const sizeCheck = validateOutputSize(irJson);
    if (sizeCheck.warning) console.error(`⚠ ${sizeCheck.warning}`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, irJson);
    console.error(`Wrote IR to ${outPath}`);
  } else if (args.includes("--metadata")) {
    console.log(JSON.stringify(generateMetadata(fullSchema, permissions, annotations, cascadePolicies), null, 2));
  } else if (args.includes("--unified-jsonschema")) {
    console.log(JSON.stringify(result.unifiedJsonSchemas, null, 2));
  } else if (args.includes("--annotations")) {
    console.log(JSON.stringify(flattenAnnotations(annotations), null, 2));
  } else {
    console.log("// Generated SpiceDB/Zed Schema from TypeSpec type graph");
    console.log("// Produced by walking the compiled TypeSpec program.");
    console.log("");
    console.log(result.spicedbOutput);
  }
}

function startWatch(args: string[], resolvedMain: string): void {
  const projectRoot = path.dirname(resolvedMain);
  const watchDirs = [
    path.resolve(projectRoot, "../lib"),
    projectRoot,
  ].filter((d) => fs.existsSync(d));

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 300;

  function onFileChange(eventType: string, filename: string | null): void {
    if (filename && !filename.endsWith(".tsp")) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const ts = new Date().toLocaleTimeString();
      console.error(`\n[${ts}] File change detected${filename ? `: ${filename}` : ""}, recompiling...`);
      try {
        await runOnce(args, resolvedMain);
        console.error(`[${new Date().toLocaleTimeString()}] Done.`);
      } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] Error:`, err instanceof Error ? err.message : err);
      }
    }, DEBOUNCE_MS);
  }

  for (const dir of watchDirs) {
    fs.watch(dir, { recursive: true }, onFileChange);
    console.error(`Watching ${dir} for .tsp changes...`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mainFile = args.find((a) => !a.startsWith("--")) ||
    path.resolve(__dirname, "../schema/main.tsp");
  const resolvedMain = path.resolve(mainFile);

  await runOnce(args, resolvedMain);

  if (args.includes("--watch")) {
    startWatch(args, resolvedMain);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
