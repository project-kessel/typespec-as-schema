# TypeSpec-as-Schema POC

Prototype exploring [TypeSpec](https://typespec.io/) as a unified schema representation for Kessel (same RBAC + HBI benchmark as sibling POCs).

## How It Works

Service teams write `.tsp` files declaring resources and permissions. A standalone TypeScript CLI compiles them into SpiceDB schemas, metadata, and JSON Schema -- no manual wiring needed.

```
 .tsp files                     src/ (11 modules, ~1600 lines)

┌──────────────┐         ┌──────────────────────┐
│ lib/         │         │  1. COMPILE           │
│  kessel.tsp  │         │  TypeSpec compiler    │
│  kessel-     │────┐    │  parses .tsp into     │
│  extensions  │    │    │  a typed Program      │
│  .tsp        │    │    └──────────┬───────────┘
├──────────────┤    │               │
│ schema/      │    │    ┌──────────┴───────────┐
│  main.tsp    │────┤    │  2. DISCOVER          │
│  rbac.tsp    │    │    │  (discover.ts)        │
│  hbi.tsp     │────┤    │  Walk the Program:    │
│  remediations│    │    │  • resources          │
│  .tsp        │────┘    │  • V1 perms           │
└──────────────┘         │  • annotations        │
                         │  • cascade policies   │
                         └──────────┬───────────┘
                                    │
                         ┌──────────┴───────────┐
                         │  3. EXPAND            │         Outputs
                         │  (expand.ts)          │
                         │  Pure expansion math: │  ┌────────────────────┐
                         │  • Role: 4 bool +     │  │ SpiceDB .zed       │
                         │    1 union perm        │  │ (default)          │
                         │  • RoleBinding:        │  ├────────────────────┤
                         │    1 intersect perm    │  │ Metadata JSON      │
                         │  • Workspace:          │  │ (--metadata)       │
                         │    1 union perm        │  ├────────────────────┤
                         │  + view_metadata       │  │ Unified JSON Schema│
                         │  + cascade delete      │  │ (--unified-        │
                         └──────────┬───────────┘  │  jsonschema)        │
                                    │              ├────────────────────┤
                         ┌──────────┴───────────┐  │ IR JSON            │
                         │  4. VALIDATE          │  │ (--ir)             │
                         │  (safety.ts)          │  ├────────────────────┤
                         │  • complexity budget   │  │ Preview            │
                         │  • expression refs     │  │ (--preview <perm>) │
                         │  • output size         │  └─────────▲─────────┘
                         └──────────┬───────────┘             │
                                    │              ┌──────────┴──────────┐
                                    └─────────────▶│  5. GENERATE + EMIT │
                                                   │  (generate.ts)      │
                                                   └─────────────────────┘

  Pipeline orchestration: pipeline.ts (compile → discover → validate → expand → generate)
  Extension template registry: registry.ts (single source of truth for template names + params)
```

## Quick Start

```bash
npm install
npx tsx src/spicedb-emitter.ts schema/main.tsp            # SpiceDB output
npx tsx src/spicedb-emitter.ts schema/main.tsp --metadata  # per-service metadata
npx tsx src/spicedb-emitter.ts schema/main.tsp --ir        # full IR for Go consumer
npx tsx src/spicedb-emitter.ts schema/main.tsp --preview inventory_host_view  # preview extension
npx vitest run                                             # 203 tests
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
    lib["lib/\nkessel.tsp\nkessel-extensions.tsp"]
    schema["schema/\nmain.tsp, rbac.tsp\nhbi.tsp, remediations.tsp"]
  end

  subgraph pipeline ["Pipeline (src/, 11 modules)"]
    compile["1. Compile\n@typespec/compiler\n.tsp → typed Program"]
    discover["2. Discover\ndiscover.ts: resources,\nV1 perms, annotations,\ncascade policies"]
    budget["validateComplexityBudget"]
    expand["3. Expand\nexpand.ts: pure expansion math\n7 mutations/perm + cascade delete"]
    validate["4. Validate\nvalidatePermissionExpressions\nvalidateOutputSize"]
    generate["5. Generate + Emit\ngenerate.ts"]
    pipemod["pipeline.ts orchestrates\nsteps 1–5"]
    registry["registry.ts\ntemplate definitions"]
  end

  subgraph outputs ["Outputs (one per invocation)"]
    spicedb["SpiceDB .zed\n(default)"]
    meta["Metadata JSON\n(--metadata)"]
    jsonschema["Unified JSON Schema\n(--unified-jsonschema)"]
    ir["IR JSON\n(--ir)"]
    preview["Preview\n(--preview perm)"]
  end

  lib --> compile
  schema --> compile
  registry -.-> discover
  compile --> discover
  discover --> budget --> expand --> validate --> generate
  pipemod -.-> compile
  generate --> spicedb
  generate --> meta
  generate --> jsonschema
  generate --> ir
  generate --> preview
```

### Decorators vs CLI Pipeline

This project does **not** use custom TypeSpec decorators or a registered TypeSpec emitter plugin (`$onEmit`). Instead:

- **Built-in decorators only** — `@doc`, `@format`, `@pattern`, `@jsonSchema` from the standard library are used in `schema/hbi.tsp` for data validation. These drive the built-in `@typespec/json-schema` emitter that writes `tsp-output/`. The `--emit-jsonschema` flag runs the JSON Schema emitter in the same compilation pass so a separate `tsp compile` invocation is no longer needed.
- **Model templates as data carriers** — `V1WorkspacePermission`, `CascadeDeletePolicy`, and `ResourceAnnotation` in `lib/kessel-extensions.tsp` are plain TypeSpec `model` definitions with type parameters. They carry parameters but have zero compile-time behavior. The comment in `kessel-extensions.tsp` says: *"Templates carry parameters only; expansion logic lives in src/expand.ts."*
- **Standalone CLI** — `spicedb-emitter.ts` calls `compile()` from `@typespec/compiler` to get a `Program` object, then walks it with custom TypeScript functions (`discoverResources`, `discoverV1Permissions`, etc.). It is not registered as a TypeSpec emitter plugin — it is a standalone script that uses the compiler as a library. A `--watch` flag re-runs the pipeline on `.tsp` file changes without needing TypeSpec's plugin watch infrastructure.
- **Type-safe verb narrowing** — `V1Extension.verb` is typed as `KesselVerb` (`"read" | "write" | "create" | "delete"`) rather than `string`, enforcing valid verbs at the TypeScript type level. A runtime `VALID_VERBS` set is kept for alias discovery where the type system can't reach.
- **Two-pass expression validation** — Permission expressions (`Permission<"expr">`) are validated both pre-expansion (catches typos in service-authored schemas before RBAC mutations) and post-expansion (catches cross-resource reference errors in the fully expanded schema).
- **Discovery health tracking** — Alias resolution stats (`aliasesAttempted`, `aliasesResolved`, `resourcesFound`, `extensionsFound`) are tracked during discovery and surfaced as warnings when aliases are skipped, making silent regressions in the name-based discovery path visible.

This approach was chosen so the full pipeline is visible in one file (`pipeline.ts`) and can be tested without TypeSpec plugin infrastructure. For the roadmap toward converting to a plugin, see [docs/Emitter-Plugin-Roadmap.md](docs/Emitter-Plugin-Roadmap.md).

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

src/                             CLI + pipeline (11 modules)
  types.ts                         Core interfaces: ResourceDef, RelationBody, V1Extension, IR
  utils.ts                         Shared helpers: bodyToZed, slotName, findResource, cloneResources, isAssignable
  parser.ts                        Recursive-descent parser for permission expressions
  registry.ts                      Extension template registry (single source of truth for template names + params)
  discover.ts                      AST walking: resource discovery + extension instance enumeration
  expand.ts                        Pure expansion math: V1 permission / cascade delete expansion (no AST)
  pipeline.ts                      Pipeline orchestration: compile → discover → validate → expand → generate
  generate.ts                      Output generators: SpiceDB, JSON Schema, metadata, IR
  safety.ts                        Defense-in-depth guards: complexity, timeout, output size, validation
  lib.ts                           Barrel module re-exporting all public API
  spicedb-emitter.ts               CLI entry point

test/                            203 tests
  helpers/                         Shared test infrastructure
    pipeline.ts                      Compile + discover + expand pipeline fixture
    zed-parser.ts                    SpiceDB definition block parser
  unit/                            Pure unit tests (no TypeSpec compilation)
  integration/                     Full pipeline + golden output comparison + CLI smoke tests
```

## Output Formats

| Output | Flag | Format | Audience | Scope |
|---|---|---|---|---|
| SpiceDB | *(default)* | Zed DSL | Authorization engine | Full authz schema |
| Metadata | `--metadata` | JSON | Platform tooling | Per-service permission/resource lists |
| Unified JSON Schema | `--unified-jsonschema` | JSON Schema | API servers/clients | Per-resource payload contracts |
| IR | `--ir [path]` | JSON | Go binaries, CI | All of the above + raw type graph + annotations |
| Preview | `--preview <perm>` | Human text | Service developers | Single extension mutation trace |

## Risks and Tradeoffs

- **Node.js in CI** for `tsp` + `tsx`; Go loader example (`go-loader-example/`) needs no Node at runtime
- **New extension types** require adding logic to `src/expand.ts`
- **Two JSON Schema paths** — built-in `@jsonSchema` emit vs unified schema (mitigated by `--emit-jsonschema` flag which runs both in one pass)

## Future: TypeSpec Emitter Plugin

The current standalone CLI architecture is intentional — see [Decorators vs CLI Pipeline](#decorators-vs-cli-pipeline) above. For the roadmap toward converting to a registered TypeSpec emitter plugin (`$onEmit`), including migration triggers, reuse analysis, and custom decorator opportunities, see [docs/Emitter-Plugin-Roadmap.md](docs/Emitter-Plugin-Roadmap.md).
