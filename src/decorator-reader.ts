// Reads decorator metadata from a compiled TypeSpec program.
//
// After compilation, the pipeline calls these functions to find models
// annotated with @provider, @annotation, and @cascadeDelete. This data
// drives auto-registration, annotation collection, and cascade-delete
// policy generation — eliminating verbose alias-based boilerplate.
//
// We read decorator args directly from the type graph rather than using
// the state-map API, because TypeSpec loads the library JS from dist/
// while the pipeline runs from source via tsx — different module instances
// would produce different state-key symbols.

import { type Program, type Model, type Namespace, type DecoratorApplication } from "@typespec/compiler";
import { getNamespaceFQN, camelToSnake } from "./utils.js";
import type { ExtensionTemplateDef } from "./registry.js";
import type { ExtensionProvider } from "./provider.js";
import type { AnnotationEntry, CascadeDeleteEntry } from "./types.js";

export interface ProviderDecoratorMetadata {
  id: string;
  ownedNamespace?: string;
  costPerInstance?: number;
  applicationParam?: string;
  permissionParam?: string;
}

export interface DiscoveredProviderTemplate {
  metadata: ProviderDecoratorMetadata;
  template: ExtensionTemplateDef;
}

function extractArg<T extends string | number>(dec: DecoratorApplication, index: number, kind: T extends string ? "string" : "number"): T | undefined {
  const arg = dec.args[index];
  if (!arg) return undefined;
  const val = arg.value;
  if (typeof val === "object" && val !== null && "value" in val && typeof val.value === kind) {
    return val.value as T;
  }
  return undefined;
}

function findProviderDecorator(model: Model): DecoratorApplication | undefined {
  return model.decorators?.find(
    (d) => d.decorator?.name === "$provider",
  );
}

/**
 * Walks the compiled program and finds all models decorated with @provider.
 * Returns the provider metadata and an auto-generated ExtensionTemplateDef
 * for each decorated template.
 */
export function discoverProviderTemplates(program: Program): DiscoveredProviderTemplate[] {
  const results: DiscoveredProviderTemplate[] = [];
  const seen = new Set<string>();

  function visit(ns: Namespace): void {
    for (const [, model] of ns.models) {
      const dec = findProviderDecorator(model);
      if (!dec) continue;

      const id = extractArg<string>(dec, 0, "string");
      if (!id) continue;

      const key = `${id}::${model.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const paramNames = [...model.properties.keys()];
      const namespace = getNamespaceFQN(ns);

      results.push({
        metadata: {
          id,
          ownedNamespace: extractArg<string>(dec, 1, "string"),
          costPerInstance: extractArg<number>(dec, 2, "number"),
          applicationParam: extractArg<string>(dec, 3, "string"),
          permissionParam: extractArg<string>(dec, 4, "string"),
        },
        template: {
          templateName: model.name,
          paramNames,
          namespace,
        },
      });
    }

    for (const [, childNs] of ns.namespaces) {
      visit(childNs);
    }
  }

  visit(program.getGlobalNamespaceType());
  return results;
}

/**
 * Merges @provider decorator metadata into providers, adding templates
 * and updating provider fields. Mutates the providers in place.
 */
export function enrichProvidersFromDecorators(
  program: Program,
  providers: ExtensionProvider[],
): void {
  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const decoratorTemplates = discoverProviderTemplates(program);

  for (const dt of decoratorTemplates) {
    const provider = providerMap.get(dt.metadata.id);
    if (!provider) continue;

    const alreadyRegistered = provider.templates.some(
      (t) => t.templateName === dt.template.templateName && t.namespace === dt.template.namespace,
    );
    if (!alreadyRegistered) {
      provider.templates.push(dt.template);
    }

    if (dt.metadata.ownedNamespace) {
      const ns = provider.ownedNamespaces ?? [];
      if (!ns.includes(dt.metadata.ownedNamespace)) {
        ns.push(dt.metadata.ownedNamespace);
        provider.ownedNamespaces = ns;
      }
    }
    if (dt.metadata.costPerInstance != null) provider.costPerInstance = dt.metadata.costPerInstance;
    if (dt.metadata.applicationParam) provider.applicationParamKey = dt.metadata.applicationParam;
    if (dt.metadata.permissionParam) provider.permissionParamKey = dt.metadata.permissionParam;
  }
}

// ─── Annotation + CascadeDelete decorator readers ─────────────────

function inferApplicationResource(model: Model): { application: string; resource: string } | undefined {
  const ns = model.namespace;
  if (!ns) return undefined;
  const fqn = getNamespaceFQN(ns);
  const leaf = fqn.split(".").pop();
  if (!leaf) return undefined;
  return {
    application: camelToSnake(leaf),
    resource: camelToSnake(model.name),
  };
}

function findDecoratorsByName(model: Model, name: string): DecoratorApplication[] {
  return model.decorators?.filter((d) => d.decorator?.name === name) ?? [];
}

/**
 * Walks the program for models decorated with @annotation and returns
 * aggregated annotations keyed by "application/resource".
 */
export function discoverAnnotationDecorators(program: Program): Map<string, AnnotationEntry[]> {
  const result = new Map<string, AnnotationEntry[]>();

  function visit(ns: Namespace): void {
    for (const [, model] of ns.models) {
      const decs = findDecoratorsByName(model, "$annotation");
      if (decs.length === 0) continue;

      const identity = inferApplicationResource(model);
      if (!identity) continue;
      const resourceKey = `${identity.application}/${identity.resource}`;

      for (const dec of decs) {
        const key = extractArg<string>(dec, 0, "string");
        const value = extractArg<string>(dec, 1, "string");
        if (!key) continue;

        let list = result.get(resourceKey);
        if (!list) {
          list = [];
          result.set(resourceKey, list);
        }
        list.push({ key, value: value ?? "" });
      }
    }
    for (const [, childNs] of ns.namespaces) visit(childNs);
  }

  visit(program.getGlobalNamespaceType());
  return result;
}

/**
 * Walks the program for models decorated with @cascadeDelete and returns
 * cascade-delete entries with application/resource inferred from the model.
 */
export function discoverCascadeDeleteDecorators(program: Program): CascadeDeleteEntry[] {
  const results: CascadeDeleteEntry[] = [];

  function visit(ns: Namespace): void {
    for (const [, model] of ns.models) {
      const decs = findDecoratorsByName(model, "$cascadeDelete");
      if (decs.length === 0) continue;

      const identity = inferApplicationResource(model);
      if (!identity) continue;

      for (const dec of decs) {
        const parentRelation = extractArg<string>(dec, 0, "string");
        if (!parentRelation) continue;
        results.push({
          childApplication: identity.application,
          childResource: identity.resource,
          parentRelation,
        });
      }
    }
    for (const [, childNs] of ns.namespaces) visit(childNs);
  }

  visit(program.getGlobalNamespaceType());
  return results;
}
