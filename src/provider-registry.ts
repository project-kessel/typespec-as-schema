// Provider Registry
//
// Defines the contract for Kessel extension providers and a registry
// so the emitter can discover/expand providers without hard-coded imports.
//
// A provider owns a domain (e.g. RBAC) and declares:
//   - what namespaces it owns (excluded from per-service metadata/jsonschema)
//   - how to discover its extensions from a compiled TypeSpec program
//   - how to expand the resource graph with discovered extensions
//   - optionally, post-expansion steps (e.g. delete scaffold wiring)
//   - optionally, metadata contributions (permission names per application)

import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "./types.js";
import { discoverTemplateInstances, type TemplateDef } from "./discover-templates.js";

// ─── Provider contract ───────────────────────────────────────────────

export interface ProviderDiscoveryResult {
  data: unknown;
  warnings: string[];
}

export interface ProviderExpansionResult {
  resources: ResourceDef[];
  warnings: string[];
}

export interface MetadataContribution {
  permissionsByApp: Record<string, string[]>;
}

export interface KesselProvider {
  name: string;
  ownedNamespaces: string[];

  discover(program: Program): ProviderDiscoveryResult;

  expand(
    resources: ResourceDef[],
    discovery: ProviderDiscoveryResult,
  ): ProviderExpansionResult;

  postExpand?(resources: ResourceDef[]): ResourceDef[];

  contributeMetadata?(discovery: ProviderDiscoveryResult): MetadataContribution;
}

// ─── defineProvider ──────────────────────────────────────────────────

export interface ProviderTemplateConfig {
  name: string;
  params: string[];
  namespace?: string;
  filter?: (params: Record<string, string>) => boolean;
}

export interface ProviderConfig<T> {
  name: string;
  ownedNamespaces: string[];
  template: ProviderTemplateConfig;
  expand(resources: ResourceDef[], data: T[]): ProviderExpansionResult;
  postExpand?(resources: ResourceDef[]): ResourceDef[];
  contributeMetadata?(data: T[]): MetadataContribution;
}

/**
 * High-level helper that constructs and registers a KesselProvider from
 * pure domain logic. The provider author supplies only an expansion function,
 * a template descriptor, and optional hooks — all discovery, registration,
 * and contract plumbing is handled by the platform.
 */
export function defineProvider<T>(config: ProviderConfig<T>): KesselProvider {
  const templateDef: TemplateDef = {
    templateName: config.template.name,
    paramNames: config.template.params,
    namespace: config.template.namespace ?? "Kessel",
  };

  const provider: KesselProvider = {
    name: config.name,
    ownedNamespaces: config.ownedNamespaces,

    discover(program: Program): ProviderDiscoveryResult {
      const { results, skipped } = discoverTemplateInstances(program, templateDef);
      const filtered = config.template.filter
        ? results.filter(config.template.filter)
        : results;
      return { data: filtered as unknown as T[], warnings: skipped };
    },

    expand(resources: ResourceDef[], discovery: ProviderDiscoveryResult): ProviderExpansionResult {
      return config.expand(resources, discovery.data as T[]);
    },

    postExpand: config.postExpand
      ? (resources: ResourceDef[]) => config.postExpand!(resources)
      : undefined,

    contributeMetadata: config.contributeMetadata
      ? (discovery: ProviderDiscoveryResult) => config.contributeMetadata!(discovery.data as T[])
      : undefined,
  };

  registerProvider(provider);
  return provider;
}

// ─── Registry ────────────────────────────────────────────────────────

const providers: KesselProvider[] = [];

export function registerProvider(provider: KesselProvider): void {
  if (providers.some((p) => p.name === provider.name)) {
    throw new Error(`Provider "${provider.name}" is already registered`);
  }
  providers.push(provider);
}

export function getProviders(): readonly KesselProvider[] {
  return providers;
}

export function clearProviders(): void {
  providers.length = 0;
}
