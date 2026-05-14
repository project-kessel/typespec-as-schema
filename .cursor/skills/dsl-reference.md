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
- `Ref<"name">` → reference: `name`
- `SubRef<"rel", "sub">` → arrow (subref): `t_rel->sub`
- `Or<A, B>` → union: `A + B`
- `And<A, B>` → intersection: `(A & B)`

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

## Decorators

### @v1Permission

Registers a V1 workspace permission. Triggers 7 RBAC mutations and auto-wires a permission relation on the resource model.

```typespec
@v1Permission("inventory", "hosts", "read", "inventory_host_view")
model Host {
  workspace: WorkspaceRef;
}
```

Parameters: `(application, resource, verb, v2PermissionName)`

Auto-wired relations by verb:

| Verb | Relation |
|------|----------|
| `read` | `view` |
| `write` | `update` |
| `create` | `create` |
| `delete` | `delete` |

### @cascadeDelete

Wires a `delete` permission on the resource through the parent relation. Also creates the full RBAC chain (role → role_binding → workspace → child).

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

## Extension Templates (`lib/kessel-extensions.tsp`)

### V1WorkspacePermission (type definition)

The underlying template type used by `@v1Permission`. Service authors should use the decorator instead of referencing this template directly.

```typespec
model V1WorkspacePermission<App, Resource, Verb, V2Perm> { ... }
```

### CascadeDeletePolicy

```typespec
model CascadeDeletePolicy<ChildApp, ChildResource, ParentRelation> { ... }
```

### ResourceAnnotation

```typespec
model ResourceAnnotation<Application, Resource, Key, Value> { ... }
```

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

# Run tests
npx vitest run
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Namespace | PascalCase in TypeSpec | `Inventory` → `inventory/` in SpiceDB |
| Resource model | PascalCase | `Host` → `inventory/host` |
| V2 permission | `{app}_{resource}_{action}` | `inventory_host_view` |
| Relation slot in Zed | `t_{relation}` | `t_workspace` |
| Application | lowercase, underscore separated | `content_sources` |
| Resource (in decorator) | lowercase plural | `hosts`, `templates` |
