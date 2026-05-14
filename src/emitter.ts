// Kessel Emitter Plugin — $onEmit
//
// The TypeSpec emitter entry point. Discovers resources, permissions,
// cascade policies, and annotations from the compiled program, then
// expands RBAC relations and generates output artifacts.

import { type EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import type { KesselEmitterOptions } from "./lib.js";
import { discoverDecoratedCascadePolicies, discoverDecoratedAnnotations } from "./discover-decorated.js";
import { discoverResources } from "./discover-resources.js";
import {
  discoverV1Permissions,
  expandV1Permissions,
  wireDeleteScaffold,
  wirePermissionRelations,
  buildPermissionsByApp,
} from "./expand-v1.js";
import { expandCascadeDeletePolicies } from "./expand-cascade.js";
import { generateSpiceDB, generateUnifiedJsonSchemas, generateMetadata } from "./generate.js";
import {
  validatePreExpansionExpressions,
  validatePermissionExpressions,
} from "./safety.js";
import { ResourceGraph } from "./resource-graph.js";

export async function $onEmit(context: EmitContext<KesselEmitterOptions>) {
  if (context.program.compilerOptions.noEmit) return;

  const { program } = context;
  const format = context.options["output-format"] ?? "spicedb";
  const strict = context.options.strict ?? false;
  const warnings: string[] = [];

  // ─── 1. Discovery ───────────────────────────────────────────────
  const { resources: baseResources } = discoverResources(program);
  const permissions = discoverV1Permissions(program);
  const cascadePolicies = discoverDecoratedCascadePolicies(program);
  const annotations = discoverDecoratedAnnotations(program);

  // ─── 2. Auto-wire permission relations from @v1Permission ───────
  wirePermissionRelations(baseResources, permissions);

  // ─── 3. Pre-expansion validation ────────────────────────────────
  const preExpansionDiags = validatePreExpansionExpressions(baseResources);
  for (const d of preExpansionDiags) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  // ─── 4. V1 permission expansion ─────────────────────────────────
  const expandGraph = new ResourceGraph(baseResources);
  expandV1Permissions(expandGraph, permissions);
  const afterExpansion = expandGraph.toResources();
  warnings.push(...expandGraph.warnings);

  // ─── 5. Delete scaffold wiring ──────────────────────────────────
  const scaffoldGraph = new ResourceGraph(afterExpansion);
  wireDeleteScaffold(scaffoldGraph);
  const scaffolded = scaffoldGraph.toResources();

  // ─── 6. Cascade-delete expansion ────────────────────────────────
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

  // ─── 8. Build metadata ──────────────────────────────────────────
  const permissionsByApp = buildPermissionsByApp(permissions);
  const metadataContributions = [{ permissionsByApp }];
  const ownedNamespaces = new Set(["rbac"]);

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
