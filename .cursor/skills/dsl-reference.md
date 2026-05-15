# Kessel TypeSpec DSL Reference

Quick reference for the TypeSpec vocabulary used in Kessel schema definitions.

## Core Types (`lib/kessel.tsp`)

### Cardinality

```typespec
enum Cardinality {
  AtMostOne,    // 0..1
  ExactlyOne,   // 1..1 (mandatory)
  AtLeastOne,   // 1..N
  Any,          // 0..N (default)
  All,          // wildcard
}
```

### Assignable

A directly reportable relation (appears in SpiceDB as both a `relation` and `permission`).

```typespec
workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>
```

SpiceDB output:
```
relation t_workspace: rbac/workspace
permission workspace = t_workspace
```

### Pre-composed Aliases (`lib/aliases.tsp`)

| Alias | Expands to | Use |
|---|---|---|
| `WorkspaceRef` | `Assignable<RBAC.Workspace, Cardinality.ExactlyOne>` | Every service resource's workspace relation |

```typespec
workspace: WorkspaceRef
```

### Permission

A computed permission derived from set operations on other relations.

```typespec
view: Permission<SubRef<"workspace", "inventory_host_view">>
```

Expression types:
- `Ref<"name">` — reference: `name`
- `SubRef<"rel", "sub">` — arrow (subref): `t_rel->sub`
- `Or<A, B>` — union: `A + B`
- `And<A, B>` — intersection: `(A & B)`

### BoolRelation

A boolean relation that holds wildcard references (`target:*`).

```typespec
isAdmin: BoolRelation<RBAC.Principal>
```

SpiceDB output:
```
relation t_isAdmin: rbac/principal:*
permission isAdmin = t_isAdmin
```

## Extension Templates

Extensions are TypeSpec model templates in provider-owned namespaces. Service authors use them via `alias` declarations.

### RBAC: V1WorkspacePermission (`schema/rbac/rbac-extensions.tsp`)

Namespace: `RBAC`

```typespec
alias myPerm = RBAC.V1WorkspacePermission<"myapp", "widgets", "read", "myapp_widget_view">;
```

Parameters: `(application, resource, verb, v2PermissionName)`

The RBAC provider discovers these aliases and expands 7 mutations per instance across role / role_binding / workspace. It also auto-wires permission relations on the resource:

| Verb | Auto-wired relation |
|------|---------------------|
| `read` | `view` |
| `write` | `update` |
| `create` | `create` |
| `delete` | `delete` |

### HBI: ExposeHostPermission (`schema/hbi/hbi-extensions.tsp`)

Namespace: `HBI`

```typespec
alias rosHost = HBI.ExposeHostPermission<"ros_read_analysis", "ros_read_analysis">;
```

Parameters: `(v2Perm, hostPerm)`

The HBI provider adds a computed permission on `inventory/host` gated on `view & workspace->{v2Perm}`.

## Platform Decorators

These are platform-owned, applied directly on resource models:

### @cascadeDelete

Wires a `delete` permission on the resource through the parent relation. The RBAC provider scaffolds the delete chain on role / role_binding / workspace.

```typespec
@cascadeDelete("workspace")
model Template {
  workspace: WorkspaceRef;
}
```

Parameter: `(parentRelation)` — the relation name on the child pointing to the parent.

App and resource names are inferred from the namespace and model name.

### @resourceAnnotation

Attaches non-RBAC metadata to a resource. Appears in metadata JSON but not in SpiceDB output.

```typespec
@resourceAnnotation("retention_days", "365")
model Template {
  workspace: WorkspaceRef;
}
```

Parameters: `(key, value)` — both strings.

App and resource names are inferred from the namespace and model name.

## Data Fields

Data fields are native TypeSpec scalar properties on resource models. The emitter extracts them into the unified JSON schema with validation constraints.

```typespec
model Host {
  workspace: WorkspaceRef;

  @format("uuid") subscription_manager_id?: string;
  @maxLength(255) ansible_host?: string;
  satellite_id?: UuidString | SatelliteNumericId;
}
```

Supported decorators: `@format`, `@maxLength`, `@minLength`, `@pattern`

Optional fields are wrapped in `oneOf` with `null` in the JSON schema.

## CLI Commands

```bash
# Generate SpiceDB schema (default)
npx tsp compile schema/main.tsp

# Generate metadata JSON
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata

# Generate unified JSON schemas
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=unified-jsonschema

# Strict mode (post-expansion validation failures → errors)
npx tsp compile schema/main.tsp --option typespec-as-schema.strict=true

# All outputs at once
make run

# Run tests
npx vitest run
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Namespace | PascalCase in TypeSpec | `Inventory` → `inventory/` in SpiceDB |
| Resource model | PascalCase | `Host` → `inventory/host` |
| Extension namespace | PascalCase, provider-owned | `RBAC`, `HBI` |
| V2 permission | `{app}_{resource}_{action}` | `inventory_host_view` |
| Relation slot in Zed | `t_{relation}` | `t_workspace` |
| Application | lowercase, underscore separated | `content_sources` |
| Resource (in template) | lowercase plural | `hosts`, `templates` |
