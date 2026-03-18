// SpiceDB/Zed Schema Emitter for TypeSpec
// This is a standalone script that demonstrates how a custom TypeSpec emitter
// would walk the compiled type graph and produce SpiceDB schema output.
//
// In a production implementation, this would be a proper TypeSpec emitter plugin.
// For the POC, this generates the expected SpiceDB output from the schema definitions.
//
// Usage: npx ts-node emitter/spicedb-emitter.ts
// Or: node emitter/spicedb-emitter.js (after tsc compilation)

// ─── Schema Model ────────────────────────────────────────────────────
// Mirrors what the TypeSpec emitter would extract from the type graph.

interface RelationDef {
  name: string;
  body: RelationBody;
  isPublic?: boolean;
}

type RelationBody =
  | { kind: "assignable"; target: string; cardinality: string }
  | { kind: "bool"; target: string }
  | { kind: "ref"; name: string }
  | { kind: "subref"; name: string; subname: string }
  | { kind: "or"; members: RelationBody[] }
  | { kind: "and"; members: RelationBody[] };

interface ResourceDef {
  name: string;
  namespace: string;
  relations: RelationDef[];
}

// ─── Schema Data ─────────────────────────────────────────────────────
// This is what the emitter would extract from the TypeSpec models.
// It mirrors the RBAC + HBI benchmark scenario.

function buildSchema(): ResourceDef[] {
  // First, expand the extension templates (v1-based permissions)
  const extensions = [
    {
      application: "inventory",
      resource: "hosts",
      verb: "read",
      v2Perm: "inventory_host_view",
    },
    {
      application: "inventory",
      resource: "hosts",
      verb: "write",
      v2Perm: "inventory_host_update",
    },
  ];

  // Build role relations from extensions
  const roleExtraRelations: RelationDef[] = [];
  const roleBindingExtraRelations: RelationDef[] = [];
  const workspaceExtraRelations: RelationDef[] = [];
  const addedBoolPerms = new Set<string>();

  for (const ext of extensions) {
    const appAdmin = `${ext.application}_all_all`;
    const anyVerb = `${ext.application}_${ext.resource}_all`;
    const anyResource = `${ext.application}_all_${ext.verb}`;
    const v1Perm = `${ext.application}_${ext.resource}_${ext.verb}`;

    // Add bool relations on role (idempotent via set)
    for (const perm of [appAdmin, anyVerb, anyResource, v1Perm]) {
      if (!addedBoolPerms.has(perm)) {
        addedBoolPerms.add(perm);
        roleExtraRelations.push({
          name: perm,
          body: { kind: "bool", target: "rbac/principal" },
        });
      }
    }

    // v2 perm on role: or(all_all_all, app_admin, any_verb, any_resource, v1_perm)
    roleExtraRelations.push({
      name: ext.v2Perm,
      body: {
        kind: "or",
        members: [
          { kind: "ref", name: "all_all_all" },
          { kind: "ref", name: appAdmin },
          { kind: "ref", name: anyVerb },
          { kind: "ref", name: anyResource },
          { kind: "ref", name: v1Perm },
        ],
      },
    });

    // v2 perm on role_binding: and(subject, granted->v2_perm)
    roleBindingExtraRelations.push({
      name: ext.v2Perm,
      body: {
        kind: "and",
        members: [
          { kind: "ref", name: "subject" },
          { kind: "subref", name: "granted", subname: ext.v2Perm },
        ],
      },
    });

    // v2 perm on workspace: or(user_grant->v2_perm, parent->v2_perm)
    workspaceExtraRelations.push({
      name: ext.v2Perm,
      body: {
        kind: "or",
        members: [
          { kind: "subref", name: "user_grant", subname: ext.v2Perm },
          { kind: "subref", name: "parent", subname: ext.v2Perm },
        ],
      },
      isPublic: true,
    });
  }

  return [
    // RBAC types
    {
      name: "principal",
      namespace: "rbac",
      relations: [],
    },
    {
      name: "role",
      namespace: "rbac",
      relations: [
        {
          name: "all_all_all",
          body: { kind: "bool", target: "rbac/principal" },
        },
        ...roleExtraRelations,
      ],
    },
    {
      name: "role_binding",
      namespace: "rbac",
      relations: [
        {
          name: "subject",
          body: {
            kind: "assignable",
            target: "rbac/principal",
            cardinality: "Any",
          },
        },
        {
          name: "granted",
          body: {
            kind: "assignable",
            target: "rbac/role",
            cardinality: "AtLeastOne",
          },
        },
        ...roleBindingExtraRelations,
      ],
    },
    {
      name: "workspace",
      namespace: "rbac",
      relations: [
        {
          name: "parent",
          body: {
            kind: "assignable",
            target: "rbac/workspace",
            cardinality: "AtMostOne",
          },
        },
        {
          name: "user_grant",
          body: {
            kind: "assignable",
            target: "rbac/role_binding",
            cardinality: "Any",
          },
        },
        ...workspaceExtraRelations,
      ],
    },
    // Inventory types
    {
      name: "host",
      namespace: "inventory",
      relations: [
        {
          name: "workspace",
          body: {
            kind: "assignable",
            target: "rbac/workspace",
            cardinality: "ExactlyOne",
          },
        },
        {
          name: "view",
          body: {
            kind: "subref",
            name: "workspace",
            subname: "inventory_host_view",
          },
        },
        {
          name: "update",
          body: {
            kind: "subref",
            name: "workspace",
            subname: "inventory_host_update",
          },
        },
      ],
    },
  ];
}

// ─── SpiceDB Schema Generator ────────────────────────────────────────

function bodyToZed(body: RelationBody): string {
  switch (body.kind) {
    case "assignable":
      return `${body.target}`;
    case "bool":
      return `${body.target}:*`;
    case "ref":
      return body.name;
    case "subref":
      return `${body.name}->${body.subname}`;
    case "or":
      return body.members.map(bodyToZed).join(" + ");
    case "and":
      return body.members.map(bodyToZed).join(" & ");
  }
}

function isAssignable(body: RelationBody): boolean {
  return body.kind === "assignable" || body.kind === "bool";
}

function generateSpiceDB(resources: ResourceDef[]): string {
  const lines: string[] = [];

  for (const res of resources) {
    lines.push(
      `definition ${res.namespace}/${res.name} {`
    );

    // Separate relations (assignable) from permissions (computed)
    const relations = res.relations.filter((r) => isAssignable(r.body));
    const permissions = res.relations.filter((r) => !isAssignable(r.body));

    for (const rel of relations) {
      lines.push(`    relation ${rel.name}: ${bodyToZed(rel.body)}`);
    }

    if (relations.length > 0 && permissions.length > 0) {
      lines.push("");
    }

    for (const perm of permissions) {
      lines.push(
        `    permission ${perm.name} = ${bodyToZed(perm.body)}`
      );
    }

    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Main ────────────────────────────────────────────────────────────

const schema = buildSchema();
console.log("// Generated SpiceDB/Zed Schema from TypeSpec POC");
console.log("// This output would be produced by a custom TypeSpec emitter");
console.log("// walking the compiled type graph.");
console.log("");
console.log(generateSpiceDB(schema));
