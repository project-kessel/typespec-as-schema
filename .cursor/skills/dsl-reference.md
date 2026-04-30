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
view: Permission<"workspace.inventory_host_view">
```

Expression syntax:
- `a.b` → arrow (subref): `t_a->b`
- `a + b` → union: `a + b`
- `a & b` → intersection: `(a & b)`
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

```typespec
alias x = Kessel.CascadeDeletePolicy<ChildApp, ChildResource, ParentRelation>
```

Parameters:
- `ChildApp` — application owning the child resource
- `ChildResource` — child resource name
- `ParentRelation` — relation on the child pointing to the parent

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

# Run tests
npx vitest run
```

## Architecture

```
schema/*.tsp          →  TypeSpec Compiler  →  Type Graph
                                                    ↓
                                            discoverResources()
                                            discoverV1Permissions()
                                            discoverAnnotations()
                                            discoverCascadeDeletePolicies()
                                                    ↓
                                            expandV1Permissions()
                                            expandCascadeDeletePolicies()
                                                    ↓
                                            generateSpiceDB()
                                            generateMetadata()
                                            generateUnifiedJsonSchemas()
                                            generateIR()
```

Trust boundary: service authors write `schema/*.tsp` (declarative); expansion logic lives in platform-owned `src/expand.ts`.
