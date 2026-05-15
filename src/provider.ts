// Extension Provider Interface
//
// The contract for extension providers. Each provider declares templates
// to discover, an expand function to run, and optional lifecycle hooks.
// The emitter orchestrates providers without domain-specific knowledge.

import type { Program } from "@typespec/compiler";
import type { ResourceDef } from "./types.js";
import type { TemplateDef } from "./discover-templates.js";

export interface DiscoveredExtension {
  kind: string;
  params: Record<string, string>;
}

export interface ProviderExpansionResult {
  resources: ResourceDef[];
  warnings: string[];
}

export interface ExtensionProvider {
  id: string;
  templates: TemplateDef[];
  discover(program: Program): DiscoveredExtension[];
  expand(resources: ResourceDef[], discovered: DiscoveredExtension[]): ProviderExpansionResult;
  onBeforeCascadeDelete?(resources: ResourceDef[]): ResourceDef[];
}
