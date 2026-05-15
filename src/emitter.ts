// Kessel Emitter Plugin — $onEmit
//
// Discovers resources, runs extension providers, handles cascade-delete,
// and generates output artifacts. Domain logic lives in providers
// (schema/rbac/, schema/hbi/); the emitter just orchestrates them.

import { type EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import type { KesselEmitterOptions } from "./lib.js";
import { discoverDecoratedCascadePolicies, discoverDecoratedAnnotations } from "./discover-decorated.js";
import { discoverResources } from "./discover-resources.js";
import { expandCascadeDeletePolicies } from "./expand-cascade.js";
import { generateSpiceDB, generateUnifiedJsonSchemas, generateMetadata } from "./generate.js";
import {
  validatePreExpansionExpressions,
  validatePermissionExpressions,
} from "./safety.js";
import type { ExtensionProvider } from "./provider.js";

import { rbacProvider } from "../schema/rbac/rbac-provider.js";
import { hbiProvider } from "../schema/hbi/hbi-provider.js";

const providers: ExtensionProvider[] = [rbacProvider, hbiProvider];

export async function $onEmit(context: EmitContext<KesselEmitterOptions>) {
  if (context.program.compilerOptions.noEmit) return;

  const { program } = context;
  const format = context.options["output-format"] ?? "spicedb";
  const strict = context.options.strict ?? false;
  const warnings: string[] = [];

  // ─── 1. Resource discovery ──────────────────────────────────────
  const { resources: baseResources } = discoverResources(program);

  // ─── 2. Provider discover + expand ──────────────────────────────
  const providerResults: { providerId: string; discovered: { kind: string; params: Record<string, string> }[] }[] = [];
  let currentResources = baseResources;

  for (const provider of providers) {
    const discovered = provider.discover(program);
    providerResults.push({ providerId: provider.id, discovered });
    const result = provider.expand(currentResources, discovered);
    currentResources = result.resources;
    warnings.push(...result.warnings);
  }

  // ─── 3. Pre-expansion validation ────────────────────────────────
  const preExpansionDiags = validatePreExpansionExpressions(currentResources);
  for (const d of preExpansionDiags) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  // ─── 4. Cascade-delete scaffold (per-provider) ──────────────────
  for (const provider of providers) {
    if (provider.onBeforeCascadeDelete) {
      currentResources = provider.onBeforeCascadeDelete(currentResources);
    }
  }

  // ─── 5. Cascade-delete expansion (platform-owned) ───────────────
  const cascadePolicies = discoverDecoratedCascadePolicies(program);
  const annotations = discoverDecoratedAnnotations(program);

  const cascadeResult = expandCascadeDeletePolicies(currentResources, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  // ─── 6. Post-expansion validation ───────────────────────────────
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

  // ─── 7. Build metadata ──────────────────────────────────────────
  const permissionsByApp: Record<string, string[]> = {};
  for (const { discovered } of providerResults) {
    for (const ext of discovered) {
      const app = ext.params.application;
      const perm = ext.params.v2Perm;
      if (app && perm) {
        if (!permissionsByApp[app]) permissionsByApp[app] = [];
        permissionsByApp[app].push(perm);
      }
    }
  }

  const ownedNamespaces = new Set(["rbac"]);
  const metadataContributions = [{ permissionsByApp }];

  // ─── 8. Emit based on output format ─────────────────────────────
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
