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
import { ResourceGraph } from "./resource-graph.js";
import { discoverTemplateInstances, type TemplateDef } from "./discover-templates.js";

// ─── Provider contract (emitter-facing, stable) ─────────────────────

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

// ─── defineProvider (author-facing, uses ResourceGraph) ──────────────

export interface ProviderTemplateConfig {
  name: string;
  params: string[];
  namespace?: string;
  filter?: (params: Record<string, string>) => boolean;
}

export interface ProviderConfig<T> {
  name: string;
  ownedNamespaces: string[];

  /** Decorator-based discovery: read entries from this state key. */
  stateKey?: symbol;

  /** Template-based discovery (backward compat). */
  template?: ProviderTemplateConfig;

  filter?: (data: T) => boolean;

  expand(graph: ResourceGraph, data: T[]): void;
  postExpand?(graph: ResourceGraph): void;
  contributeMetadata?(data: T[]): MetadataContribution;
}

/**
 * High-level helper that constructs and registers a KesselProvider from
 * pure domain logic. The provider author supplies only an expansion function,
 * a state key or template descriptor, and optional hooks — all discovery,
 * registration, and contract plumbing is handled by the platform.
 */
export function defineProvider<T>(config: ProviderConfig<T>): KesselProvider {
  const provider: KesselProvider = {
    name: config.name,
    ownedNamespaces: config.ownedNamespaces,

    discover(program: Program): ProviderDiscoveryResult {
      if (config.stateKey) {
        const stateMap = program.stateMap(config.stateKey);
        const allData: T[] = [];
        for (const [, entries] of stateMap) {
          const arr = entries as T[];
          if (Array.isArray(arr)) {
            allData.push(...arr);
          }
        }
        const filtered = config.filter
          ? allData.filter(config.filter)
          : allData;
        return { data: filtered, warnings: [] };
      }

      if (config.template) {
        const templateDef: TemplateDef = {
          templateName: config.template.name,
          paramNames: config.template.params,
          namespace: config.template.namespace ?? "Kessel",
        };
        const { results, skipped } = discoverTemplateInstances(
          program,
          templateDef,
        );
        const filtered = config.template.filter
          ? results.filter(config.template.filter)
          : results;
        return { data: filtered as unknown as T[], warnings: skipped };
      }

      return { data: [] as T[], warnings: [] };
    },

    expand(
      resources: ResourceDef[],
      discovery: ProviderDiscoveryResult,
    ): ProviderExpansionResult {
      const graph = new ResourceGraph(resources);
      config.expand(graph, discovery.data as T[]);
      return { resources: graph.toResources(), warnings: graph.warnings };
    },

    postExpand: config.postExpand
      ? (resources: ResourceDef[]): ResourceDef[] => {
          const graph = new ResourceGraph(resources);
          config.postExpand!(graph);
          return graph.toResources();
        }
      : undefined,

    contributeMetadata: config.contributeMetadata
      ? (discovery: ProviderDiscoveryResult) =>
          config.contributeMetadata!(discovery.data as T[])
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
