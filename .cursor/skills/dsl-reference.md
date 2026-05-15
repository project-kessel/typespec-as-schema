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

Extensions are TypeSpec model templates in provider-owned namespaces. Service authors use them via `@decorator` on models (preferred) or `alias` declarations. Both forms are auto-discovered and produce identical expansion results.

### RBAC: V1WorkspacePermission (`schema/rbac/rbac-extensions.tsp`)

Namespace: `RBAC`

**Decorator style** (preferred when a model exists -- requires `using RBAC;`):

```typespec
@v1Permission("read", "widgets", "myapp", "myapp_widget_view")
model Widget { ... }
```

Decorator parameters: `(verb, resource, application, v2PermissionName)`

**Alias style** (alternative, works without a model):

```typespec
alias myPerm = RBAC.V1WorkspacePermission<"myapp", "widgets", "read", "myapp_widget_view">;
```

Template parameters: `<application, resource, verb, v2PermissionName>`

The RBAC provider discovers both forms and expands 7 mutations per instance across role / role_binding / workspace. It also auto-wires permission relations on the resource:

| Verb | Auto-wired relation |
|------|---------------------|
| `read` | `view` |
| `write` | `update` |
| `create` | `create` |
| `delete` | `delete` |

### HBI: ExposeHostPermission (`schema/hbi/hbi-extensions.tsp`)

Namespace: `HBI`

**Decorator style** (requires `using HBI;`):

```typespec
@exposeHostPermission("ros_read_analysis", "ros_read_analysis")
model Host { ... }
```

Decorator parameters: `(v2Perm, hostPerm)`

**Alias style:**

```typespec
alias rosHost = HBI.ExposeHostPermission<"ros_read_analysis", "ros_read_analysis">;
```

Template parameters: `(v2Perm, hostPerm)`

The HBI provider adds a computed permission on `inventory/host` gated on `view & workspace->{v2Perm}`.

## Decorators

### Platform Decorators

These are platform-owned (`using Kessel;`), applied directly on resource models:

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

### Provider Decorators

These are defined by extension providers and wired into the package entry via build-time codegen (`scripts/gen-decorator-wiring.mjs`). Use the provider namespace or `using RBAC;` / `using HBI;`.

### @v1Permission (RBAC)

Registers a V1 workspace permission on a resource model. Equivalent to a `RBAC.V1WorkspacePermission<...>` alias but co-located on the model.

```typespec
using RBAC;

@v1Permission("read", "widgets", "myapp", "myapp_widget_view")
model Widget {
  workspace: WorkspaceRef;
}
```

Parameters: `(verb, resource, application, v2Perm)`
- `verb` — `"read"` | `"write"` | `"create"` | `"delete"`
- `resource` — lowercase plural resource name
- `application` — lowercase application identifier
- `v2Perm` — snake_case v2 permission name

### @exposeHostPermission (HBI)

Exposes a workspace-level permission on the host resource. Equivalent to `HBI.ExposeHostPermission<...>`.

```typespec
using HBI;

@exposeHostPermission("inventory_host_view", "view_vulnerability")
model Host { ... }
```

Parameters: `(v2Perm, hostPerm)`
- `v2Perm` — the workspace permission name to pass through
- `hostPerm` — the permission name to expose on the host

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
