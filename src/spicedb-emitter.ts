// Kessel Schema Emitter — CLI Composition Root
//
// This is the only file that knows which providers are active. It wires
// providers into the generic pipeline and handles CLI output formatting.
// The pipeline itself (pipeline.ts) is provider-neutral.
//
// Usage: npx tsx src/spicedb-emitter.ts [schema/main.tsp] [--metadata] [--ir [outpath]] [--unified-jsonschema] [--preview <perm>] [--annotations] [--no-strict] [--emit-jsonschema] [--watch]

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
import type { ExtensionProvider } from "./provider.js";
import { rbacProvider } from "../schema/rbac/rbac-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROVIDERS: ExtensionProvider[] = [rbacProvider];

async function runOnce(args: string[], resolvedMain: string): Promise<void> {
  const emitJsonSchema = args.includes("--emit-jsonschema");

  console.error(`Compiling ${resolvedMain}...`);

  const providers = DEFAULT_PROVIDERS;

  const result = await compilePipeline(resolvedMain, { providers, emitJsonSchema });
  const {
    providerResults,
    providerMap,
    annotations,
    cascadePolicies,
    fullSchema,
    preExpansionDiagnostics,
    diagnostics,
    warnings,
    resources,
    ownedNamespaces,
  } = result;

  const allExtensions = providerResults.flatMap((pr) => pr.discovered);
  const isStrict = !args.includes("--no-strict");

  for (const w of warnings) {
    console.error(`Warning: ${w}`);
  }

  if (preExpansionDiagnostics.length > 0) {
    console.error(`\n⚠ Pre-expansion validation found ${preExpansionDiagnostics.length} issue(s):`);
    for (const d of preExpansionDiagnostics) {
      console.error(`  ${d.resource}.${d.relation}: ${d.message}`);
    }
    console.error("");
    if (isStrict) {
      throw new Error("Pre-expansion validation failed");
    }
  }

  if (diagnostics.length > 0) {
    console.error(`\n⚠ Permission expression validation found ${diagnostics.length} issue(s):`);
    for (const d of diagnostics) {
      console.error(`  ${d.resource}.${d.relation}: ${d.message}`);
    }
    console.error("");
    if (isStrict) {
      throw new Error("Permission expression validation failed");
    }
  }

  console.error(
    `Discovered ${resources.length} resources, ${allExtensions.length} extensions, expanded to ${fullSchema.length} resource defs.`,
  );

  if (args.includes("--preview")) {
    const previewIdx = args.indexOf("--preview");
    const targetPerm = args[previewIdx + 1];
    if (!targetPerm || targetPerm.startsWith("--")) {
      const available = allExtensions
        .map((e) => {
          const parts = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(", ");
          return `  ${e.kind}: ${parts}`;
        })
        .join("\n");
      throw new Error(`Usage: --preview <permission_name>\nAvailable extensions:\n${available}`);
    }

    const ext = allExtensions.find((e) =>
      Object.values(e.params).includes(targetPerm),
    );
    if (!ext) {
      console.error(`No extension found matching "${targetPerm}".`);
      console.error("Available extensions:");
      for (const e of allExtensions) {
        const parts = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(", ");
        console.error(`  ${e.kind}: ${parts}`);
      }
      throw new Error(`No extension found matching "${targetPerm}".`);
    }

    console.log(`Preview: ${ext.kind}`);
    console.log(`Parameters: ${JSON.stringify(ext.params, null, 2)}\n`);

    console.log("Expanded SpiceDB for affected resources:\n");
    for (const ns of ownedNamespaces) {
      const nsResources = fullSchema.filter((r) => r.namespace === ns);
      for (const resourceDef of nsResources) {
        const matching = resourceDef.relations.filter((r) =>
          Object.values(ext.params).some((v) => r.name === v),
        );
        if (matching.length > 0) {
          console.log(`  ${resourceDef.namespace}/${resourceDef.name}:`);
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
    }

    const matchingCascade = cascadePolicies.filter(
      (p) => Object.values(ext.params).includes(p.childApplication),
    );
    for (const cp of matchingCascade) {
      console.log(`\n  + CascadeDeletePolicy: ${cp.childApplication}/${cp.childResource}`);
      console.log(`       permission delete = ${slotName(cp.parentRelation)}->delete`);
    }
  } else if (args.includes("--ir")) {
    const irIndex = args.indexOf("--ir");
    const nextArg = args[irIndex + 1];
    const outPath = nextArg && !nextArg.startsWith("--")
      ? nextArg
      : path.resolve(__dirname, "../go-loader-example/schema/resources.json");
    const ir = generateIR(resolvedMain, fullSchema, providerResults, providerMap, ownedNamespaces, annotations, cascadePolicies);
    const irJson = JSON.stringify(ir, null, 2) + "\n";
    const sizeCheck = validateOutputSize(irJson);
    if (sizeCheck.warning) console.error(`⚠ ${sizeCheck.warning}`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, irJson);
    console.error(`Wrote IR to ${outPath}`);
  } else if (args.includes("--metadata")) {
    console.log(JSON.stringify(generateMetadata(fullSchema, providerResults, providerMap, ownedNamespaces, annotations, cascadePolicies), null, 2));
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
  let running = false;
  let nullFilenameWarned = false;
  const DEBOUNCE_MS = 300;

  function onFileChange(_eventType: string, filename: string | null): void {
    if (filename === null) {
      if (!nullFilenameWarned) {
        console.error("Note: platform does not report filenames in watch events; all changes trigger recompilation.");
        nullFilenameWarned = true;
      }
    } else if (!filename.endsWith(".tsp")) {
      return;
    }

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      if (running) return;
      running = true;
      const ts = new Date().toLocaleTimeString();
      console.error(`\n[${ts}] File change detected${filename ? `: ${filename}` : ""}, recompiling...`);
      try {
        await runOnce(args, resolvedMain);
        console.error(`[${new Date().toLocaleTimeString()}] Done.`);
      } catch (err) {
        console.error(`[${new Date().toLocaleTimeString()}] Error:`, err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    }, DEBOUNCE_MS);
  }

  const watchers: fs.FSWatcher[] = [];
  for (const dir of watchDirs) {
    watchers.push(fs.watch(dir, { recursive: true }, onFileChange));
    console.error(`Watching ${dir} for .tsp changes...`);
  }

  process.on("SIGINT", () => {
    for (const w of watchers) w.close();
    process.exit(0);
  });
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
