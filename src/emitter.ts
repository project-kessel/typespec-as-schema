// Kessel Emitter Plugin — $onEmit
//
// The registered TypeSpec emitter entry point. Replaces the standalone
// CLI pipelines (spicedb-emitter.ts, emitter-v2.ts, emitter-v3.ts)
// with a single `tsp compile` invocation.
//
// Providers register themselves via the provider registry; the emitter
// loops over them for discovery, expansion, and metadata contribution.

import { type EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import type { KesselEmitterOptions } from "./lib.js";
import { discoverDecoratedCascadePolicies, discoverDecoratedAnnotations } from "./discover-decorated.js";
import { discoverResources } from "./discover-resources.js";
import { getProviders, type ProviderDiscoveryResult, type MetadataContribution } from "./provider-registry.js";
import "./providers/rbac/rbac-provider.js";
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

  // ─── 1. Platform discovery ─────────────────────────────────────
  const { resources: baseResources } = discoverResources(program);
  const cascadePolicies = discoverDecoratedCascadePolicies(program);
  const annotations = discoverDecoratedAnnotations(program);

  // ─── 2. Provider discovery ─────────────────────────────────────
  const providers = getProviders();
  const discoveryResults = new Map<string, ProviderDiscoveryResult>();
  for (const provider of providers) {
    const result = provider.discover(program);
    discoveryResults.set(provider.name, result);
    warnings.push(...result.warnings);
  }

  // ─── 3. Pre-expansion validation ──────────────────────────────
  const preExpansionDiags = validatePreExpansionExpressions(baseResources);
  for (const d of preExpansionDiags) {
    warnings.push(`Pre-expansion: ${d.resource}.${d.relation}: ${d.message}`);
  }

  // ─── 4. Provider expansion ────────────────────────────────────
  let resources = baseResources;
  for (const provider of providers) {
    const discovery = discoveryResults.get(provider.name)!;
    const expanded = provider.expand(resources, discovery);
    resources = expanded.resources;
    warnings.push(...expanded.warnings);
  }

  // ─── 5. Provider post-expansion ───────────────────────────────
  for (const provider of providers) {
    if (provider.postExpand) {
      resources = provider.postExpand(resources);
    }
  }

  // ─── 6. Cascade-delete expansion ──────────────────────────────
  const cascadeResult = expandCascadeDeletePolicies(resources, cascadePolicies);
  const fullSchema = cascadeResult.resources;
  warnings.push(...cascadeResult.warnings);

  // ─── 7. Post-expansion validation ─────────────────────────────
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

  // ─── 8. Collect provider metadata and owned namespaces ────────
  const ownedNamespaces = new Set<string>();
  const metadataContributions: MetadataContribution[] = [];
  for (const provider of providers) {
    for (const ns of provider.ownedNamespaces) {
      ownedNamespaces.add(ns);
    }
    if (provider.contributeMetadata) {
      const discovery = discoveryResults.get(provider.name)!;
      metadataContributions.push(provider.contributeMetadata(discovery));
    }
  }

  // ─── 9. Emit based on output format ───────────────────────────
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
