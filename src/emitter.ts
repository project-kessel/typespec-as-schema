// Kessel Emitter Plugin — $onEmit
//
// The registered TypeSpec emitter entry point. Replaces the standalone
// CLI pipelines (spicedb-emitter.ts, emitter-v2.ts, emitter-v3.ts)
// with a single `tsp compile` invocation.

import { type EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import type { KesselEmitterOptions } from "./lib.js";
import { discoverDecoratedCascadePolicies, discoverDecoratedAnnotations } from "./discover-decorated.js";
import { discoverResources } from "./discover-resources.js";
import { expandV1Permissions, wireDeleteScaffold, discoverV1Permissions } from "./providers/rbac/rbac-provider.js";
import { expandCascadeDeletePolicies } from "./expand-cascade.js";
import { generateSpiceDB, generateUnifiedJsonSchemas, generateMetadata } from "./generate.js";
import {
  validatePreExpansionExpressions,
  validatePermissionExpressions,
} from "./safety.js";

export async function $onEmit(context: EmitContext<KesselEmitterOptions>) {
  if (context.program.compilerOptions.noEmit) return;

  const { program } = context;
  const format = context.options["output-format"] ?? "spicedb";
  const strict = context.options.strict ?? false;
  const warnings: string[] = [];

  // ─── 1. Discover via decorator state sets ───────────────────────
  const { resources } = discoverResources(program);
  const permissions = discoverV1Permissions(program);
  const cascadePolicies = discoverDecoratedCascadePolicies(program);
  const annotations = discoverDecoratedAnnotations(program);

  // ─── 2. Pre-expansion validation ────────────────────────────────
  const preExpansionDiags = validatePreExpansionExpressions(resources);
  for (const d of preExpansionDiags) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  // ─── 3. RBAC expansion ──────────────────────────────────────────
  const { resources: afterRbac, warnings: rbacWarnings } = expandV1Permissions(resources, permissions);
  warnings.push(...rbacWarnings);

  // ─── 4. Cascade-delete expansion ────────────────────────────────
  const scaffolded = wireDeleteScaffold(afterRbac);
  const cascadeResult = expandCascadeDeletePolicies(scaffolded, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  // ─── 5. Post-expansion validation ──────────────────────────────
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

  // ─── 6. Emit based on output format ─────────────────────────────
  const ownedNamespaces = new Set(["rbac"]);

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
      const metadata = generateMetadata(resources, permissions, ownedNamespaces, annotations, cascadePolicies);
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
