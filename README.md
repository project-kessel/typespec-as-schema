# TypeSpec-as-Schema POC

Prototype exploring [TypeSpec](https://typespec.io/) as a unified schema representation for Kessel (same RBAC + HBI benchmark as sibling POCs).

## How It Works

Service teams write `.tsp` files declaring resources and permissions via template aliases. Extension providers define expansion logic in TypeScript via `defineProvider`. A **TypeSpec emitter plugin** (`$onEmit`) orchestrates providers and compiles declarations into SpiceDB schemas, metadata, and JSON Schema.

```
 .tsp files                     src/ (emitter plugin)

┌──────────────┐         ┌──────────────────────┐
│ lib/         │         │  1. COMPILE           │
│  main.tsp    │         │  TypeSpec compiler    │
│  kessel.tsp  │────┐    │  parses .tsp into     │
│  aliases.tsp │    │    │  a typed Program      │
│  decorators  │    │    └──────────┬───────────┘
│  .tsp        │    │               │
├──────────────┤    │    ┌──────────┴───────────┐
│ schema/rbac/ │    │    │  2. DISCOVER          │
│  rbac.tsp    │────┤    │  Resources + data     │         Outputs
│  rbac-ext.tsp│    │    │  fields from models   │
│  rbac-       │    │    └──────────┬───────────┘  ┌────────────────────┐
│  provider.ts │    │               │              │ SpiceDB .zed       │
├──────────────┤    │    ┌──────────┴───────────┐  │ (default)          │
│ schema/hbi/  │    │    │  3. PROVIDER LOOP     │  ├────────────────────┤
│  hbi.tsp     │────┤    │  For each provider:   │  │ Metadata JSON      │
│  hbi-ext.tsp │    │    │  discover → expand    │  ├────────────────────┤
│  hbi-        │    │    │  (template scanning   │  │ Unified JSON Schema│
│  provider.ts │    │    │   + ResourceDef[]     │  └─────────▲──────────┘
├──────────────┤    │    │   mutations)          │            │
│ schema/      │    │    └──────────┬───────────┘            │
│  main.tsp    │────┤               │                        │
│  remediations│    │    ┌──────────┴───────────┐            │
│  .tsp        │────┘    │  4. CASCADE + EMIT   │────────────┘
└──────────────┘         │  Cascade-delete +    │
                         │  generate outputs    │
                         └──────────────────────┘

  Emitter entry:    src/emitter.ts ($onEmit)
  Provider helper:  src/define-provider.ts (defineProvider)
  RBAC provider:    schema/rbac/rbac-provider.ts
  HBI provider:     schema/hbi/hbi-provider.ts
```

## Quick Start

```bash
npm install
make build

npx tsp compile schema/main.tsp                                                 # SpiceDB output (default)
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata        # per-service metadata
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=unified-jsonschema  # JSON Schema

npx vitest run       # run tests
make run             # all outputs at once
```

## What Service Teams Write

A service team adds **one `.tsp` file** with template aliases for permissions:

```typespec
import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;

namespace Inventory;

alias viewPermission = RBAC.V1WorkspacePermission<"inventory", "hosts", "read", "inventory_host_view">;
alias updatePermission = RBAC.V1WorkspacePermission<"inventory", "hosts", "write", "inventory_host_update">;

@cascadeDelete("workspace")
@resourceAnnotation("feature_flag", "staleness_v2")
model Host {
  workspace: WorkspaceRef;

  @format("uuid") subscription_manager_id?: string;
  @maxLength(255) ansible_host?: string;
}
```

Each `V1WorkspacePermission` alias triggers 7 mutations across Role, RoleBinding, and Workspace, plus auto-wires `view`/`update` relations on the resource. Data fields are extracted automatically for JSON Schema.

Then add one import to `schema/main.tsp`. Done. No TypeScript changes needed.

## Architecture

The emitter orchestrates **extension providers** — each provider declares templates to discover and an `expand` function to run. Providers are registered explicitly in `src/emitter.ts`.

| Component | Role |
|-----------|------|
| `defineProvider` | Creates a provider with auto-generated template discovery |
| `schema/rbac/rbac-provider.ts` | RBAC V1 permission expansion + cascade-delete scaffold |
| `schema/hbi/hbi-provider.ts` | HBI host permission exposure |
| `src/emitter.ts` | Orchestrates: discover → expand → cascade → generate |

Adding a new extension type: write a `.tsp` template + a provider `.ts` file + one import line in the emitter. See [docs/Guide.md](docs/Guide.md) for full details.

## File Structure

```
lib/                             Platform types (shared .tsp)
  main.tsp                        Single-import facade
  kessel.tsp                      Assignable, Permission, BoolRelation, Cardinality
  aliases.tsp                     WorkspaceRef
  decorators.tsp                  @cascadeDelete, @resourceAnnotation

schema/                          Service schemas + extension providers
  main.tsp                         Entrypoint
  remediations.tsp                 Permissions-only service
  rbac/
    rbac.tsp                       Core RBAC types
    rbac-extensions.tsp            V1WorkspacePermission template (namespace RBAC)
    rbac-provider.ts               RBAC expansion logic (defineProvider)
  hbi/
    hbi.tsp                        Host resource + data fields + permissions
    hbi-extensions.tsp             ExposeHostPermission template (namespace HBI)
    hbi-provider.ts                HBI expansion logic (defineProvider)

src/                             TypeSpec emitter plugin
  emitter.ts                       $onEmit — provider orchestration
  provider.ts                      ExtensionProvider interface
  define-provider.ts               defineProvider helper + validParams
  discover-templates.ts            Template instance scanning
  discover-resources.ts            Resource + data field extraction
  generate.ts                      SpiceDB, metadata, JSON Schema generators
  ...
```

## Documentation

See **[docs/Guide.md](docs/Guide.md)** for:

- Pipeline flow (compile → discover → provider loop → cascade → emit)
- Service developer guide (add services, resources, permissions)
- Extension author guide (write a new provider)
- Architecture and design decisions
