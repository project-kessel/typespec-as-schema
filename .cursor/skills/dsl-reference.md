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
- `a->b` → arrow: `t_a->b`
- Parentheses for grouping: `(a + b) & c`

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

## Extension Templates (`lib/kessel-extensions.tsp`)

### V1WorkspacePermission

Maps a legacy `application:resource:verb` triple to a v2 permission on the RBAC workspace.

```typespec
alias x = Kessel.V1WorkspacePermission<App, Resource, Verb, V2Perm>
```

Parameters:
- `App` — lowercase application identifier
- `Resource` — lowercase resource identifier (plural)
- `Verb` — `"read" | "write" | "create" | "delete"`
- `V2Perm` — snake_case v2 permission name

### CascadeDeletePolicy

Adds a `delete` permission on a child resource that resolves through the parent relation.
Also wires `delete` through the full RBAC chain (role → role_binding → workspace → child)
so every arrow reference resolves to an existing permission.

```typespec
alias x = Kessel.CascadeDeletePolicy<ChildApp, ChildResource, ParentRelation>
```

Parameters:
- `ChildApp` — application owning the child resource
- `ChildResource` — child resource name
- `ParentRelation` — relation on the child pointing to the parent

Generated RBAC chain:
- `rbac/role`: `permission delete = any_any_any`
- `rbac/role_binding`: `permission delete = (subject & t_granted->delete)`
- `rbac/workspace`: `permission delete = t_binding->delete + t_parent->delete`
- Child resource: `permission delete = t_{parentRelation}->delete`

### ResourceAnnotation

Attaches non-RBAC metadata to a resource. Appears in the IR but not in SpiceDB output.

```typespec
alias x = Kessel.ResourceAnnotation<Application, Resource, Key, Value>
```

## CLI Commands

```bash
# Generate SpiceDB schema
npx tsx src/spicedb-emitter.ts schema/main.tsp

# Generate metadata JSON
npx tsx src/spicedb-emitter.ts schema/main.tsp --metadata

# Generate IR (for Go consumer)
npx tsx src/spicedb-emitter.ts schema/main.tsp --ir go-loader-example/schema/resources.json

# Generate unified JSON schemas
npx tsx src/spicedb-emitter.ts schema/main.tsp --unified-jsonschema

# Preview a specific extension's mutations
npx tsx src/spicedb-emitter.ts schema/main.tsp --preview inventory_host_view

# Generate annotations JSON
npx tsx src/spicedb-emitter.ts schema/main.tsp --annotations

# Skip permission expression validation failures
npx tsx src/spicedb-emitter.ts schema/main.tsp --no-strict

# Run tests
npx vitest run
```

## Architecture

```
schema/*.tsp          →  TypeSpec Compiler  →  Type Graph
                                                    ↓
                              discover.ts:  discoverResources()
                                            discoverV1Permissions()
                                            discoverAnnotations()
                                            discoverCascadeDeletePolicies()
                                                    ↓
                              expand.ts:    expandV1Permissions()
                                            expandCascadeDeletePolicies()
                                                    ↓
                              generate.ts:  generateSpiceDB()
                                            generateMetadata()
                                            generateUnifiedJsonSchemas()
                                            generateIR()

  Orchestration:  pipeline.ts (compilePipeline)
  Registry:       registry.ts (EXTENSION_TEMPLATES — template names, params, namespaces)
  Shared helpers: utils.ts (bodyToZed, slotName, findResource, cloneResources, isAssignable)
```

Trust boundary: service authors write `schema/*.tsp` (declarative); discovery lives in `src/discover.ts`; expansion logic lives in platform-owned `src/expand.ts`.
