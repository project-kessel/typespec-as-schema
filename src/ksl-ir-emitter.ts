// KSL Intermediate Representation Emitter
// Translates TypeSpec ResourceDef[] + V1Extension[] into KSL-compatible
// intermediate.Namespace JSON that can be loaded by the KSL Go toolchain.
//
// The KSL Go side (pkg/intermediate) then calls ToSemantic() and
// ApplyExtensions() to expand extensions at the Go semantic model layer,
// fully decoupling extension logic from this emitter.

import type { ResourceDef, RelationDef, RelationBody, V1Extension } from "./lib.js";

// ─── KSL IR Types (mirrors pkg/intermediate/module.go) ──────────────

interface KslNamespace {
  name: string;
  imports?: string[];
  types?: KslType[];
  extension_references?: KslExtensionReference[];
}

interface KslType {
  name: string;
  visibility?: string;
  relations: KslRelation[];
  fields?: KslField[];
  extensions?: KslExtensionReference[];
}

interface KslField {
  name: string;
  required: boolean;
  type: { variants: KslDataTypeRef[] };
}

interface KslDataTypeRef {
  type_name: string;
  constraints?: Record<string, string>;
}

interface KslRelation {
  name: string;
  visibility?: string;
  body: KslRelationBody;
  extensions?: KslExtensionReference[];
}

interface KslRelationBody {
  kind: string;
  types?: KslTypeReference[];
  cardinality?: string;
  relation?: string;
  sub_relation?: string;
  left?: KslRelationBody;
  right?: KslRelationBody;
}

interface KslTypeReference {
  namespace?: string;
  name: string;
  sub_relation?: string;
  all?: boolean;
}

interface KslExtensionReference {
  namespace?: string;
  name: string;
  params?: Record<string, string>;
}

// ─── Translation ─────────────────────────────────────────────────────

function parseTarget(target: string): { namespace: string; name: string } {
  const parts = target.split("/");
  if (parts.length === 2) {
    return { namespace: parts[0], name: parts[1] };
  }
  return { namespace: "", name: target };
}

function stripTuplePrefix(name: string): string {
  return name.startsWith("t_") ? name.slice(2) : name;
}

function translateBody(body: RelationBody): KslRelationBody {
  switch (body.kind) {
    case "assignable": {
      const { namespace, name } = parseTarget(body.target);
      return {
        kind: "self",
        types: [{ namespace, name }],
        cardinality: body.cardinality,
      };
    }
    case "bool": {
      const { namespace, name } = parseTarget(body.target);
      return {
        kind: "self",
        types: [{ namespace, name, all: true }],
        cardinality: "All",
      };
    }
    case "ref":
      return { kind: "reference", relation: body.name };
    case "subref":
      return {
        kind: "nested_reference",
        relation: stripTuplePrefix(body.name),
        sub_relation: body.subname,
      };
    case "or":
      return foldBinary(body.members, "union");
    case "and":
      return foldBinary(body.members, "intersect");
  }
}

function foldBinary(members: RelationBody[], kind: string): KslRelationBody {
  if (members.length === 0) {
    return { kind: "reference", relation: "" };
  }
  if (members.length === 1) {
    return translateBody(members[0]);
  }

  let acc = translateBody(members[0]);
  for (let i = 1; i < members.length; i++) {
    acc = {
      kind,
      left: acc,
      right: translateBody(members[i]),
    };
  }
  return acc;
}

function translateRelation(rel: RelationDef): KslRelation {
  const kslRel: KslRelation = {
    name: rel.name,
    body: translateBody(rel.body),
  };

  if (rel.isPublic) {
    kslRel.visibility = "public";
  }

  return kslRel;
}

function buildExtensionReferences(
  extensions: V1Extension[],
  resourceName: string,
): KslExtensionReference[] {
  const refs: KslExtensionReference[] = [];

  for (const ext of extensions) {
    const viewRelation = resourceName === "host" && ext.application === "inventory";
    const remRelation = resourceName === "host" && ext.application === "remediations";

    if (viewRelation || remRelation) {
      refs.push({
        namespace: "rbac",
        name: "workspace_permission",
        params: {
          full_name: ext.v2Perm,
          v1_resource: ext.resource,
          v1_verb: ext.verb,
        },
      });
      if (ext.verb === "read") {
        refs.push({
          namespace: "rbac",
          name: "add_view_metadata",
          params: { full_name: ext.v2Perm },
        });
      }
    }
  }

  return refs;
}

// ─── Public API ──────────────────────────────────────────────────────

export function generateKslIR(
  resources: ResourceDef[],
  extensions: V1Extension[],
): KslNamespace[] {
  const namespaceMap = new Map<string, KslType[]>();

  for (const res of resources) {
    if (res.namespace === "rbac") continue;
    if (!namespaceMap.has(res.namespace)) {
      namespaceMap.set(res.namespace, []);
    }

    const kslType: KslType = {
      name: res.name,
      visibility: "public",
      relations: res.relations.map(translateRelation),
    };

    namespaceMap.get(res.namespace)!.push(kslType);
  }

  // Group extensions by application (which maps to a namespace)
  const extByApp = new Map<string, V1Extension[]>();
  for (const ext of extensions) {
    if (!extByApp.has(ext.application)) {
      extByApp.set(ext.application, []);
    }
    extByApp.get(ext.application)!.push(ext);
  }

  // Ensure permissions-only namespaces (like remediations) are included
  for (const appName of extByApp.keys()) {
    if (!namespaceMap.has(appName)) {
      namespaceMap.set(appName, []);
    }
  }

  const namespaces: KslNamespace[] = [];

  for (const [nsName, types] of namespaceMap) {
    const nsExtRefs: KslExtensionReference[] = [];
    const appExts = extByApp.get(nsName) || [];

    for (const ext of appExts) {
      nsExtRefs.push({
        namespace: "rbac",
        name: "workspace_permission",
        params: {
          full_name: ext.v2Perm,
          v1_resource: ext.resource,
          v1_verb: ext.verb,
        },
      });
      if (ext.verb === "read") {
        nsExtRefs.push({
          namespace: "rbac",
          name: "add_view_metadata",
          params: { full_name: ext.v2Perm },
        });
      }
    }

    const kslNs: KslNamespace = {
      name: nsName,
      imports: ["rbac"],
    };

    if (types.length > 0) {
      kslNs.types = types;
    }

    if (nsExtRefs.length > 0) {
      kslNs.extension_references = nsExtRefs;
    }

    namespaces.push(kslNs);
  }

  return namespaces;
}
