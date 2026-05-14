# TypeSpec-as-Schema Guide

End-to-end reference for **service developers** (write `.tsp` schemas) and **provider developers** (build expansion providers like RBAC).

---

## 1. Overview

Service teams write `.tsp` files declaring resources and permissions. A **TypeSpec emitter plugin** (`$onEmit`) compiles those declarations into three outputs:

| Output | Option | Audience |
|--------|--------|----------|
| **SpiceDB** `schema.zed` | `spicedb` *(default)* | Authorization engine |
| **Metadata** `metadata.json` | `metadata` | Platform tooling |
| **Unified JSON Schema** `unified-jsonschemas.json` | `unified-jsonschema` | API servers/clients |

Design principle: service `.tsp` stays **purely declarative** (types, aliases, decorated models). All expansion logic lives in reviewed TypeScript providers that implement the `KesselProvider` interface, orchestrated by the emitter's provider registry loop.

### Quick start

```bash
npm install
npm run build

npx tsp compile schema/main.tsp                                                          # SpiceDB (default)
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata        # metadata JSON
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=unified-jsonschema  # JSON Schema

npx vitest run       # tests
make demo            # all outputs at once
```

Strict mode promotes post-expansion validation failures to errors:

```bash
npx tsp compile schema/main.tsp --option typespec-as-schema.strict=true
```

---

## 2. Folder structure

```
typespec-as-schema/
├── lib/                          ← PLATFORM-OWNED (service teams: don't touch)
│   ├── kessel.tsp                  Core types: Assignable, Permission, BoolRelation, Cardinality
│   ├── kessel-extensions.tsp       Platform templates: CascadeDeletePolicy, ResourceAnnotation
│   └── decorators.tsp              extern dec: @kesselExtension, @cascadePolicy, @annotation
│
├── schema/                       ← SERVICE AUTHORS WORK HERE
│   ├── main.tsp                    Entrypoint — imports all services
│   ├── hbi.tsp                     HBI service (resource + permissions + policies)
│   ├── remediations.tsp            Permissions-only service
│   └── rbac/
│       ├── rbac.tsp                Core RBAC types: Principal, Role, RoleBinding, Workspace
│       └── rbac-extensions.tsp     V1WorkspacePermission template
│
├── src/                          ← PLATFORM-OWNED
│   ├── index.ts                    Package entry: $lib, $onEmit, decorators
│   ├── lib.ts                      Emitter library, StateKeys, barrel re-exports
│   ├── emitter.ts                  $onEmit — provider-registry-driven pipeline
│   ├── provider-registry.ts        KesselProvider interface + registerProvider / getProviders
│   ├── discover-templates.ts       Platform template discovery (AST walking, alias resolution)
│   ├── discover-resources.ts       Resource graph extraction from TypeSpec AST
│   ├── discover-decorated.ts       Cascade policies + annotations from decorator state
│   ├── types.ts                    ResourceDef, RelationBody, ServiceMetadata
│   ├── primitives.ts               ref, subref, or, and, addRelation, hasRelation
│   ├── utils.ts                    bodyToZed, slotName, getNamespaceFQN, extractParams
│   ├── decorators.ts               Decorator implementations
│   ├── expand-cascade.ts           Cascade-delete expansion
│   ├── generate.ts                 generateSpiceDB, generateMetadata, generateUnifiedJsonSchemas
│   ├── safety.ts                   Pre/post-expansion permission expression validation
│   └── providers/rbac/
│       └── rbac-provider.ts        RBAC domain: 7 mutations, delete scaffold, KesselProvider impl
│
├── test/
│   ├── unit/                       13 Vitest files (per-module)
│   ├── integration/                Full compile + benchmarks
│   ├── helpers/
│   │   ├── pipeline.ts             compilePipeline() — end-to-end test runner
│   │   └── zed-parser.ts           SpiceDB output parser
│   └── fixtures/
│       └── spicedb-reference.zed   Golden file
│
├── docs/Guide.md                   This file
├── scripts/                        validate-spicedb.sh, test-permissions.sh
├── .github/workflows/schema-ci.yml
├── package.json / tsconfig.build.json / tspconfig.yaml / Makefile
└── docker-compose.yaml
```

---

## 3. Pipeline: end-to-end flow

`tsp compile` loads the program; `$onEmit` (`src/emitter.ts`) runs the pipeline:

```
schema/main.tsp
       │
       ▼
 ┌─────────────────────────────┐
 │  1. TypeSpec Compiler        │
 │  .tsp → Program (AST +      │
 │  type graph + state sets)    │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  2. Platform Discovery       │
 │  • discoverResources()       │
 │  • @cascadePolicy state set  │
 │  • @annotation state set     │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  3. Provider Discovery Loop  │
 │  each provider.discover()    │
 │  (RBAC finds V1 permissions  │
 │   via discoverTemplateInst.) │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  4. Pre-expansion Validation │
 │  local ref/subref checks     │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  5. Provider Expansion Loop  │
 │  each provider.expand()      │
 │  + optional postExpand()     │
 │  (RBAC: 7 mutations/perm +   │
 │   delete scaffold)           │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  6. Cascade-Delete Expansion │
 │  expandCascadeDeletePolicies │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  7. Post-expansion Validation│
 │  cross-type subref checks    │
 │  (strict → compiler errors)  │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  8. Collect Provider Metadata│
 │  + ownedNamespaces           │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  9. Generate + Emit          │
 │  spicedb | metadata |        │
 │  unified-jsonschema          │
 └─────────────────────────────┘
```

**Key split:** `generateMetadata` uses **pre-expansion** resources + provider `MetadataContribution[]`. `generateSpiceDB` and `generateUnifiedJsonSchemas` use the **post-expansion** `fullSchema`.

### The 7 mutations per V1 permission

When a service declares `V1WorkspacePermission<"inventory", "hosts", "read", "inventory_host_view">`:

| # | Target | What | Example |
|---|--------|------|---------|
| 1–4 | Role | 4 bool relations (hierarchy) | `inventory_any_any`, `inventory_hosts_any`, `inventory_any_read`, `inventory_hosts_read` |
| 5 | Role | Union permission | `inventory_host_view = any_any_any + inventory_any_any + ...` |
| 6 | RoleBinding | Intersection permission | `inventory_host_view = (subject & t_granted->inventory_host_view)` |
| 7 | Workspace | Union permission | `inventory_host_view = t_binding->... + t_parent->...` |

Read-verb permissions are also OR'd into `view_metadata` on Workspace.

---

## 4. DSL surface — what service teams use

### Building blocks (`lib/kessel.tsp`)

| TypeSpec construct | SpiceDB effect |
|---|---|
| `Assignable<Target, Cardinality>` | `relation t_{name}: {target}` |
| `Permission<SubRef<"rel", "sub">>` | `permission {name} = t_{rel}->{sub}` |
| `BoolRelation<Target>` | `relation t_{name}: {target}:*` |

### Cardinality

| Cardinality | Meaning | JSON Schema effect |
|---|---|---|
| `ExactlyOne` | Required, single value | `{name}_id` field, required |
| `AtMostOne` | Optional, single value | `{name}_id` field, optional |
| `AtLeastOne` | Required, one or more | Array, minItems: 1 |
| `Any` | Optional, zero or more | Array |
| `All` | Wildcard (`principal:*`) | N/A |

### Extension templates

| Template | Parameters | Mutations | Discovery |
|----------|-----------|-----------|-----------|
| `V1WorkspacePermission<App, Res, Verb, V2>` | 4 | 7 | Template/alias walking |
| `CascadeDeletePolicy<ChildApp, ChildRes, ParentRel>` | 3 | 1 | `@cascadePolicy` decorator |
| `ResourceAnnotation<App, Res, Key, Val>` | 4 | 0 (metadata only) | `@annotation` decorator |

### Naming conventions

| Element | Convention | Example |
|---------|------------|---------|
| Namespace | PascalCase in TypeSpec, lowercase in SpiceDB | `Inventory` → `inventory` |
| Resource model | PascalCase | `Host` → `inventory/host` |
| V2 permission | `{app}_{resource}_{action}` | `inventory_host_view` |
| Relation slot in Zed | `t_{relation}` | `t_workspace` |

---

## 5. Service developer guide

### Add a permissions-only service

Create `schema/notifications.tsp`:

```typespec
import "../lib/kessel.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;

namespace Notifications;

alias viewPermission = Kessel.V1WorkspacePermission<
  "notifications", "notifications", "read",
  "notifications_notification_view"
>;

alias updatePermission = Kessel.V1WorkspacePermission<
  "notifications", "notifications", "write",
  "notifications_notification_update"
>;
```

Wire it in `schema/main.tsp`:

```typespec
import "./notifications.tsp";
```

Compile:

```bash
npm run build && npx tsp compile schema/main.tsp
```

**Effort: 1 file, ~20 lines, zero TypeScript.**

### Add a full resource type

Create `schema/content-sources.tsp`:

```typespec
import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "../lib/decorators.tsp";
import "./rbac/rbac-extensions.tsp";
import "./rbac/rbac.tsp";

using JsonSchema;
using Kessel;

namespace ContentSources;

alias templateView = Kessel.V1WorkspacePermission<
  "content_sources", "templates", "read", "content_sources_template_view"
>;
alias templateEdit = Kessel.V1WorkspacePermission<
  "content_sources", "templates", "write", "content_sources_template_edit"
>;

@cascadePolicy
model templateCascade is CascadeDeletePolicy<"content_sources", "template", "workspace">;

@annotation
model templateRetention is ResourceAnnotation<"content_sources", "template", "retention_days", "365">;

@jsonSchema
model TemplateData {
  @maxLength(255) name?: string;
  @format("uri") repository_url?: string;
}

model Template {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  data: TemplateData;
  view: Permission<SubRef<"workspace", "content_sources_template_view">>;
  edit: Permission<SubRef<"workspace", "content_sources_template_edit">>;
}
```

SpiceDB output:
```
definition content_sources/template {
    permission workspace = t_workspace
    permission view = t_workspace->content_sources_template_view
    permission edit = t_workspace->content_sources_template_edit
    relation t_workspace: rbac/workspace
}
```

**Effort: 1 file, ~40 lines, zero TypeScript.**

### Add a resource type to an existing service

Edit your existing `.tsp` file — add permission aliases, optional data model, and the resource model. No changes to `main.tsp` needed since it already imports the file.

### Step-by-step checklist

1. **Choose shape:** permissions-only (aliases only) vs. resource types + data + policies.
2. **Add** `schema/<your-service>.tsp`.
3. **Imports:** always `kessel.tsp` + `rbac/rbac-extensions.tsp` + `rbac/rbac.tsp`. Add `decorators.tsp` for `@cascadePolicy`/`@annotation`. Add `@typespec/json-schema` for data models.
4. **Register permissions:** one `alias` per `Kessel.V1WorkspacePermission<App, Res, Verb, v2Perm>`.
5. **Define resources** (if any): models with `Assignable` / `Permission<SubRef<...>>`.
6. **Optional:** `@cascadePolicy` on `CascadeDeletePolicy<...>`; `@annotation` on `ResourceAnnotation<...>`.
7. **Wire:** `import "./<your-service>.tsp";` in `schema/main.tsp`.
8. **Verify:** `npm run build && npx tsp compile schema/main.tsp`.

### Decorators

| Decorator | Apply to | Purpose |
|-----------|----------|---------|
| `@cascadePolicy` | `model ... is CascadeDeletePolicy<childApp, childRes, parentRelation>` | Child's `delete` permission wired through parent relation |
| `@annotation` | `model ... is ResourceAnnotation<app, res, key, value>` | Key/value metadata in `metadata.json`; no SpiceDB effect |
| `@kesselExtension` | Any model | Optional marker; **not required** for RBAC V1 discovery |

---

## 6. Provider developer guide

Providers encapsulate domain-specific expansion logic (e.g., RBAC). Use `defineProvider<T>()` to register a provider with only domain logic — template discovery, registry membership, and contract plumbing are handled by the platform.

### `defineProvider<T>()` — the recommended API

```typescript
import { defineProvider } from "../../provider-registry.js";

interface MyExtension {
  param1: string;
  param2: string;
}

export const myProvider = defineProvider<MyExtension>({
  name: "my-domain",
  ownedNamespaces: ["my_domain"],

  template: {
    name: "MyTemplate",
    params: ["param1", "param2"],
    namespace: "Kessel",       // optional, defaults to "Kessel"
    filter: (p) => !!p.param1, // optional, pre-filters discovered instances
  },

  expand(resources, data) {
    // 'data' is already typed as MyExtension[] — discovered and filtered
    // Mutate the resource graph using primitives (ref, subref, or, and, addRelation)
    return { resources, warnings: [] };
  },

  // Optional: runs after all providers have expanded
  postExpand(resources) {
    return resources;
  },

  // Optional: contributes permission names to metadata.json
  contributeMetadata(data) {
    return { permissionsByApp: {} };
  },
});
```

| Config field | Required | Purpose |
|---|---|---|
| `name` | Yes | Unique provider identifier |
| `ownedNamespaces` | Yes | Namespaces excluded from per-service metadata/jsonschema |
| `template.name` | Yes | TypeSpec model name to discover instances of |
| `template.params` | Yes | Template parameter names to extract |
| `template.namespace` | No | Namespace containing the template (default: `"Kessel"`) |
| `template.filter` | No | Predicate to exclude invalid discovered instances |
| `expand(resources, data)` | Yes | Domain logic — mutate resource graph with typed extensions |
| `postExpand(resources)` | No | Post-expansion transforms (e.g., scaffold wiring) |
| `contributeMetadata(data)` | No | Provide `permissionsByApp` for `metadata.json` |

**What the platform handles for you:**
- Template instance discovery (AST walking, alias resolution, `program.checker`)
- Filter application and type casting
- Provider registration in the global registry
- `ProviderDiscoveryResult` / `ProviderExpansionResult` wrapping

### Add a new provider (3 steps)

**1. Define a `.tsp` template** in `schema/<domain>/` or `lib/`:

```typespec
namespace Kessel;
model MyTemplate<Param1 extends string, Param2 extends string> {
  param1: Param1;
  param2: Param2;
}
```

**2. Create a provider** in `src/providers/<domain>/<domain>-provider.ts`:

```typescript
import { defineProvider } from "../../provider-registry.js";
import { addRelation } from "../../primitives.js";
import type { ResourceDef } from "../../types.js";

interface MyExtension {
  param1: string;
  param2: string;
}

export const myProvider = defineProvider<MyExtension>({
  name: "my-domain",
  ownedNamespaces: ["my_domain"],
  template: { name: "MyTemplate", params: ["param1", "param2"] },

  expand(resources, extensions) {
    // Your domain logic here — no imports from @typespec/compiler needed
    return { resources, warnings: [] };
  },
});
```

**3. Wire** the side-effect import in `src/emitter.ts`:

```typescript
import "./providers/my-domain/my-provider.js";
```

That's it. Add tests in `test/unit/` for your expansion logic.

### Advanced: raw `KesselProvider` interface

For edge cases that don't fit the template-discovery pattern, the low-level interface is still available:

```typescript
interface KesselProvider {
  name: string;
  ownedNamespaces: string[];
  discover(program: Program): ProviderDiscoveryResult;
  expand(resources: ResourceDef[], discovery: ProviderDiscoveryResult): ProviderExpansionResult;
  postExpand?(resources: ResourceDef[]): ResourceDef[];
  contributeMetadata?(discovery: ProviderDiscoveryResult): MetadataContribution;
}
```

Use `registerProvider(provider)` directly. This requires importing `Program` from `@typespec/compiler` and calling `discoverTemplateInstances()` yourself.

### Architecture layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1: Schema (.tsp)                                               │
│ schema/*.tsp, lib/*.tsp — declarations, aliases, decorators          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│ Layer 2: Platform infrastructure                                     │
│ provider-registry.ts — defineProvider + KesselProvider + registry     │
│ discover-templates.ts — shared template discovery (AST walking)       │
│ expand-cascade.ts — cascade-delete from CascadeDeleteEntry[]          │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│ Layer 3: Domain providers (reviewed TS — only domain logic)           │
│ rbac-provider.ts — RBAC expansion + scaffold wiring                   │
│ (new providers use defineProvider, never touch Program)               │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│ Layer 4: Emitter orchestration                                        │
│ emitter.ts — loops registered providers for discover → expand →       │
│   postExpand; then cascade → validate → generate                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Future extensions (not yet implemented)

The production `rbac-config` has extension types beyond `V1WorkspacePermission`:

| KSL extension | Purpose | TypeSpec equivalent |
|---|---|---|
| `add_v1_based_permission` | V1 → workspace permission | `V1WorkspacePermission` (implemented) |
| `add_contingent_permission` | Intersects two workspace perms | `ContingentPermission` (planned) |
| `expose_host_permission` | Passes workspace perm to host | `ExposeHostPermission` (planned) |

These follow the same pattern: define a `.tsp` template, service teams write one alias per use, expansion logic lives in a provider or platform module. Service authors write zero computation regardless of how many extension types exist.

### Extension complexity budget

| Extension | Params | Mutations | Complexity |
|-----------|--------|-----------|------------|
| `V1WorkspacePermission` | 4 | 7 | O(N) |
| `CascadeDeletePolicy` | 3 | 1 | O(N) |
| `ResourceAnnotation` | 4 | 0 | O(N) |

Total work is bounded and linear for any combination of extensions.

---

## 8. Testing and CI

### Running tests

```bash
npx vitest run              # full suite (13 unit + 2 integration)
npx vitest run test/unit
npx vitest run test/integration
```

Key test files: `discover.test.ts` (alias-only fixtures), `discover-templates.test.ts` (template discovery), `provider-registry.test.ts` (registration), `generateMetadata.test.ts`, `safety.test.ts`.

### CI (`.github/workflows/schema-ci.yml`)

Single job `build-and-test`:

1. `npm ci`
2. `npm run build`
3. `npx vitest run`
4. `npx tsp compile schema/main.tsp` (SpiceDB)
5. `tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata`

---

## 9. Design decisions

### Why decorators for cascade/annotations but template walking for RBAC

RBAC V1 permissions use template/alias walking because service teams already use `alias` declarations — adding `@kesselExtension` on every alias would be redundant. Cascade policies and annotations use decorators because `model ... is Template<> {}` works naturally with decorators and state sets provide compiler-guaranteed discovery.

### Why a provider registry and `defineProvider`

The `KesselProvider` interface and registry separate domain logic from compiler plumbing. `defineProvider<T>()` further encapsulates all discovery, registration, and contract wrapping so provider authors write only domain logic — they never import `Program` or call `discoverTemplateInstances` directly. Generic AST walking is centralized in `discover-templates.ts`; providers only declare what template they own via a config object. New providers need only new files + one side-effect import. `generateMetadata()` accepts generic `MetadataContribution[]` from any provider.

### Why three separate output formats

All three POCs (TypeSpec, Starlark, CUE) produce the same three standalone outputs. A bundled IR was removed because it added complexity without value over running `tsp compile` with different `output-format` options.

---

## 10. Summary: what each role does

| Task | Who | Files touched | TypeScript? |
|---|---|---|---|
| New permissions-only service | Service team | 1 new `.tsp` + 1 import in `main.tsp` | No |
| New resource type | Service team | 1 `.tsp` file | No |
| New data fields | Service team | Edit `*Data` model | No |
| Cascade/annotation | Service team | 1 decorated model | No |
| **New extension provider** | Provider team | `.tsp` template + `defineProvider(...)` call + side-effect import | Yes (domain logic only) |
