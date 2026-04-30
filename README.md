# TypeSpec-as-Schema POC

Prototype exploring [TypeSpec](https://typespec.io/) as a unified schema representation for Kessel (same RBAC + HBI benchmark as sibling POCs).

## How It Works

Service teams write `.tsp` files declaring resources and permissions. A TypeScript emitter compiles them into SpiceDB schemas, metadata, and JSON Schema -- no manual wiring needed.

```
 .tsp files                     src/ (9 modules)                      Outputs
┌──────────────┐
│ lib/         │         ┌──────────────────────┐
│  kessel.tsp  │         │  COMPILE             │
│  kessel-     │────┐    │  TypeSpec compiler    │
│  extensions  │    │    │  parses .tsp into     │
│  .tsp        │    │    │  a typed Program      │
├──────────────┤    │    └──────────┬───────────┘
│ schema/      │    │              │
│  main.tsp    │────┤    ┌─────────┴───────────┐
│  rbac.tsp    │    │    │  DISCOVER            │        ┌────────────────┐
│  hbi.tsp     │────┤    │  Walk the Program:   │        │ SpiceDB .zed   │
│  remediations│    │    │  • resources         │        │ (default)      │
│  .tsp        │────┘    │    (discover.ts)     │        ├────────────────┤
└──────────────┘         │  • V1 perms          │        │ Metadata JSON  │
                         │  • annotations       │        │ (--metadata)   │
                         │  • cascade policies  │        ├────────────────┤
                         │    (expand.ts)       │        │ JSON Schema    │
                         └─────────┬───────────┘        │ (--unified-    │
                                   │                     │  jsonschema)   │
                         ┌─────────┴───────────┐        ├────────────────┤
                         │  EXPAND             │        │ IR JSON        │
                         │  For each V1 perm:  │        │ (--ir)         │
                         │  • Role: 4 bool +   │        ├────────────────┤
                         │    1 union perm      │        │ Preview        │
                         │  • RoleBinding:      │        │ (--preview)    │
                         │    1 intersect perm  │        └───────▲────────┘
                         │  • Workspace:        │                │
                         │    1 union perm      │        ┌───────┴────────┐
                         │  + view_metadata     │        │  GENERATE      │
                         │    (all read perms)  │───────▶│  (generate.ts) │
                         └─────────────────────┘        └────────────────┘
```

## Quick Start

```bash
npm install
npx tsx src/spicedb-emitter.ts schema/main.tsp            # SpiceDB output
npx tsx src/spicedb-emitter.ts schema/main.tsp --metadata  # per-service metadata
npx tsx src/spicedb-emitter.ts schema/main.tsp --ir        # full IR for Go consumer
npx tsx src/spicedb-emitter.ts schema/main.tsp --preview inventory_host_view  # preview extension
npx vitest run                                             # 153 tests
make demo                                                  # console tour
```

## What Service Teams Write

A service team adds **one `.tsp` file** with two things:

**1. Register permissions** (one alias per permission):

```typespec
alias viewPermission = Kessel.V1WorkspacePermission<
  "inventory", "hosts", "read", "inventory_host_view"
>;
```

This single line triggers 7 mutations across Role, RoleBinding, and Workspace.

**2. Define the resource model:**

```typespec
model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;
}
```

Then add one import to `schema/main.tsp`. Done. No TypeScript changes needed.

## Architecture

```mermaid
flowchart TB
  subgraph input ["Input (.tsp files)"]
    lib["lib/kessel.tsp\nlib/kessel-extensions.tsp"]
    schema["schema/main.tsp\nschema/rbac.tsp\nschema/hbi.tsp\nschema/remediations.tsp"]
  end

  subgraph pipeline ["Pipeline (src/)"]
    compile["1. Compile\nTypeSpec → Program"]
    discover["2. Discover\nresources + V1 perms\n+ annotations + cascade"]
    expand["3. Expand\n7 mutations per V1 perm\n+ cascade delete"]
    validate["4. Validate\nsafety guards"]
    generate["5. Generate + Emit"]
  end

  subgraph outputs ["Outputs"]
    spicedb["SpiceDB .zed"]
    meta["Metadata JSON"]
    jsonschema["Unified JSON Schema"]
    ir["IR JSON"]
    preview["Preview (--preview)"]
  end

  lib --> compile
  schema --> compile
  compile --> discover --> expand --> validate --> generate
  generate --> spicedb
  generate --> meta
  generate --> jsonschema
  generate --> ir
  generate --> preview
```

### The 7 Mutations Per Extension

When a service declares `V1WorkspacePermission<"inventory", "hosts", "read", "inventory_host_view">`, the expansion function adds:

| # | Target | What | Example |
|---|--------|------|---------|
| 1-4 | Role | 4 bool relations (hierarchy) | `inventory_any_any`, `inventory_hosts_any`, `inventory_any_read`, `inventory_hosts_read` |
| 5 | Role | Union permission | `inventory_host_view = any_any_any + inventory_any_any + ...` |
| 6 | RoleBinding | Intersection permission | `inventory_host_view = (subject & t_granted->inventory_host_view)` |
| 7 | Workspace | Union permission | `inventory_host_view = t_binding->... + t_parent->...` |

After all extensions, read-verb permissions are OR'd into `view_metadata` on Workspace.

## File Structure

```
lib/                             Platform types (shared)
  kessel.tsp                       Assignable, Permission, BoolRelation, Cardinality
  kessel-extensions.tsp            V1WorkspacePermission, ResourceAnnotation, CascadeDeletePolicy

schema/                          Service schemas (teams own their files)
  main.tsp                         Entrypoint — imports all modules
  rbac.tsp                         Principal, Role, RoleBinding, Workspace
  hbi.tsp                          Host resource + V1 permission aliases + annotations
  remediations.tsp                 Permissions-only service

src/                             Emitter (9 modules)
  types.ts                         Core interfaces: ResourceDef, RelationBody, V1Extension, IR
  utils.ts                         Utilities: getNamespaceFQN, camelToSnake, bodyToZed
  parser.ts                        Recursive-descent parser for permission expressions
  discover.ts                      Resource discovery from compiled TypeSpec Program
  expand.ts                        Extension discovery + V1 permission / cascade delete expansion
  generate.ts                      Output generators: SpiceDB, JSON Schema, metadata, IR
  safety.ts                        Defense-in-depth guards: complexity, timeout, output size, validation
  lib.ts                           Barrel module re-exporting all public API
  spicedb-emitter.ts               CLI entry point

test/                            153 tests
  helpers/                         Shared test infrastructure
    pipeline.ts                      Compile + discover + expand pipeline fixture
    zed-parser.ts                    SpiceDB definition block parser
  unit/                            Pure unit tests (no TypeSpec compilation)
  integration/                     Full pipeline + golden output comparison
```

## Risks and Tradeoffs

- **Node.js in CI** for `tsp` + `tsx`; Go consumer runtime needs no Node
- **New extension types** require adding logic to `src/expand.ts`
- **Two JSON Schema paths** — built-in `@jsonSchema` emit vs unified schema
