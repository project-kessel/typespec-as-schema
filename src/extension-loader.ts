// Extension Loader
//
// Scans schema/**/*-extension.ts for extension modules and dynamically
// imports their compiled .js counterparts from dist/. Each module
// exports a default ExtensionModule that declares a template to discover
// and an expand function to run. The emitter calls this generically --
// it has no knowledge of specific extensions like RBAC or HBI.

import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type { TemplateDef } from "./discover-templates.js";
import type { ResourceGraph } from "./resource-graph.js";

export interface ExtensionModule {
  template: TemplateDef;
  expand(graph: ResourceGraph, instances: Record<string, string>[]): void;
  beforeCascadeDelete?(graph: ResourceGraph): void;
}

function findExtensionFiles(schemaDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith("-extension.ts")) {
        results.push(path.join(dir, entry.name));
      }
    }
  }

  walk(schemaDir);
  return results.sort();
}

/**
 * Loads all extension modules from schema/**\/*-extension.ts.
 * Imports the compiled .js from dist/schema/ (parallel to the source tree).
 * Modules are sorted by `order` (ascending, default 0).
 */
export async function loadExtensionModules(schemaDir: string): Promise<ExtensionModule[]> {
  const absSchemaDir = path.resolve(schemaDir);
  const repoRoot = path.dirname(absSchemaDir);
  const distDir = path.join(repoRoot, "dist");
  const files = findExtensionFiles(absSchemaDir);
  const modules: ExtensionModule[] = [];

  for (const file of files) {
    const relative = path.relative(repoRoot, file).replace(/\.ts$/, ".js");
    const compiledPath = path.join(distDir, relative);
    if (!fs.existsSync(compiledPath)) {
      throw new Error(
        `Compiled extension not found: ${compiledPath}\n` +
        `Source: ${file}\n` +
        `Run 'make build' to compile extensions.`,
      );
    }
    const mod = await import(pathToFileURL(compiledPath).href);
    const ext: ExtensionModule = mod.default;
    if (!ext || !ext.template || typeof ext.expand !== "function") {
      throw new Error(`Extension module ${file} must default-export { template, expand }`);
    }
    modules.push(ext);
  }

  return modules;
}
