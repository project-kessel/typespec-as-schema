// Kessel Emitter Plugin — $onEmit
//
// Domain-agnostic TypeSpec emitter. Discovers resources, loads extension
// modules from schema/**/*-extension.ts, runs their expansion functions,
// then handles cascade-delete and generates output artifacts.
// The emitter has no knowledge of RBAC, HBI, or any specific domain.

import * as path from "path";
import { fileURLToPath } from "url";
import { type EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import type { KesselEmitterOptions } from "./lib.js";
import { discoverDecoratedCascadePolicies, discoverDecoratedAnnotations } from "./discover-decorated.js";
import { discoverResources } from "./discover-resources.js";
import { discoverTemplateInstances } from "./discover-templates.js";
import { expandCascadeDeletePolicies } from "./expand-cascade.js";
import { generateSpiceDB, generateUnifiedJsonSchemas, generateMetadata } from "./generate.js";
import {
  validatePreExpansionExpressions,
  validatePermissionExpressions,
} from "./safety.js";
import { ResourceGraph } from "./resource-graph.js";
import { loadExtensionModules, type ExtensionModule } from "./extension-loader.js";

export async function $onEmit(context: EmitContext<KesselEmitterOptions>) {
  if (context.program.compilerOptions.noEmit) return;

  const { program } = context;
  const format = context.options["output-format"] ?? "spicedb";
  const strict = context.options.strict ?? false;
  const warnings: string[] = [];

  // ─── 1. Resource discovery ──────────────────────────────────────
  const { resources: baseResources } = discoverResources(program);

  // ─── 2. Load extension modules ──────────────────────────────────
  // Derive schema dir from the emitter's own location (dist/emitter.js → repo/schema/)
  const emitterDir = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot = path.resolve(emitterDir, "..");
  const schemaDir = path.join(packageRoot, "schema");
  const extensions: ExtensionModule[] = await loadExtensionModules(schemaDir);

  // ─── 3. Discover + expand each extension ────────────────────────
  const graph = new ResourceGraph(baseResources);
  const allInstances: Record<string, string>[][] = [];

  for (const ext of extensions) {
    const { results } = discoverTemplateInstances(program, ext.template);
    allInstances.push(results);
    ext.expand(graph, results);
  }
  warnings.push(...graph.warnings);

  // ─── 4. Pre-expansion validation ────────────────────────────────
  const afterExpansion = graph.toResources();
  const preExpansionDiags = validatePreExpansionExpressions(afterExpansion);
  for (const d of preExpansionDiags) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  // ─── 5. Cascade-delete scaffold (per-extension) ─────────────────
  const scaffoldGraph = new ResourceGraph(afterExpansion);
  for (const ext of extensions) {
    if (ext.beforeCascadeDelete) {
      ext.beforeCascadeDelete(scaffoldGraph);
    }
  }
  const scaffolded = scaffoldGraph.toResources();

  // ─── 6. Cascade-delete expansion (platform-owned) ───────────────
  const cascadePolicies = discoverDecoratedCascadePolicies(program);
  const annotations = discoverDecoratedAnnotations(program);

  const cascadeResult = expandCascadeDeletePolicies(scaffolded, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  // ─── 7. Post-expansion validation ───────────────────────────────
  const diagnostics = validatePermissionExpressions(fullSchema);
  if (diagnostics.length > 0 && strict) {
    for (const d of diagnostics) {
      program.reportDiagnostic({
        code: "invalid-permission-expr",
        severity: "error",
        message: `${d.resource}.${d.relation}: ${d.message}`,
        target: program.getGlobalNamespaceType(),
      });
    }
  }

  // ─── 8. Build metadata from discovered instances ────────────────
  const permissionsByApp: Record<string, string[]> = {};
  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i];
    const instances = allInstances[i];
    const appKey = ext.template.paramNames.find((k) => k === "application");
    const permKey = ext.template.paramNames.find((k) => k === "v2Perm");
    if (appKey && permKey) {
      for (const inst of instances) {
        const app = inst[appKey];
        const perm = inst[permKey];
        if (app && perm) {
          if (!permissionsByApp[app]) permissionsByApp[app] = [];
          permissionsByApp[app].push(perm);
        }
      }
    }
  }

  const ownedNamespaces = new Set(["rbac"]);
  const metadataContributions = [{ permissionsByApp }];

  // ─── 9. Emit based on output format ─────────────────────────────
  switch (format) {
    case "spicedb": {
      const spicedbOutput = generateSpiceDB(fullSchema);
      await emitFile(program, {
        path: resolvePath(context.emitterOutputDir, "schema.zed"),
        content: spicedbOutput,
      });
      break;
    }

    case "metadata": {
      const metadata = generateMetadata(baseResources, metadataContributions, ownedNamespaces, annotations, cascadePolicies);
      await emitFile(program, {
        path: resolvePath(context.emitterOutputDir, "metadata.json"),
        content: JSON.stringify(metadata, null, 2),
      });
      break;
    }

    case "unified-jsonschema": {
      const schemas = generateUnifiedJsonSchemas(fullSchema, ownedNamespaces);
      await emitFile(program, {
        path: resolvePath(context.emitterOutputDir, "unified-jsonschemas.json"),
        content: JSON.stringify(schemas, null, 2),
      });
      break;
    }
  }

  for (const w of warnings) {
    program.reportDiagnostic({
      code: "invalid-permission-expr",
      severity: "warning",
      message: w,
      target: program.getGlobalNamespaceType(),
    });
  }
}
