// Extension Provider Interface
//
// Defines the contract for service-owned extension providers. Each provider
// ships its own discovery and expansion logic using platform primitives.
// The platform pipeline orchestrates providers without hard-coding any
// domain-specific expansion rules.

import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "./types.js";
import type { ExtensionTemplateDef } from "./registry.js";

export interface DiscoveredExtension {
  kind: string;
  params: Record<string, string>;
}

export interface ProviderExpansionResult {
  resources: ResourceDef[];
  warnings: string[];
}

export interface ExtensionProvider {
  /** Unique provider ID (e.g. "rbac") */
  id: string;

  /** Template definitions this provider contributes to the registry */
  templates: ExtensionTemplateDef[];

  /** Discover instances of this provider's templates from the compiled program */
  discover(program: Program): DiscoveredExtension[];

  /** Expand discovered instances into resource mutations */
  expand(resources: ResourceDef[], discovered: DiscoveredExtension[]): ProviderExpansionResult;

  /** Namespaces this provider owns (excluded from unified JSON schema, etc.) */
  ownedNamespaces?: string[];

  /** Cost per extension instance for complexity budget (default: 1) */
  costPerInstance?: number;

  /** Param key used for namespace cross-checking (e.g. "application"). If unset, no cross-check runs for this provider. */
  applicationParamKey?: string;

  /** Param key used for permission metadata (e.g. "v2Perm"). If unset, no permission metadata is emitted for this provider. */
  permissionParamKey?: string;

  /** Optional: wire scaffold relations needed before cascade-delete expansion. Must return a new array. */
  onBeforeCascadeDelete?(resources: ResourceDef[]): ResourceDef[];
}
