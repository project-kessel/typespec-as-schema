# TypeSpec-as-Schema Guide

End-to-end reference for **service developers** writing `.tsp` schemas.

---

## 1. Overview

Service teams write `.tsp` files declaring resources and permissions. A **TypeSpec emitter plugin** (`$onEmit`) compiles those declarations into three outputs:

| Output | Option | Audience |
|--------|--------|----------|
| **SpiceDB** `schema.zed` | `spicedb` *(default)* | Authorization engine |
| **Metadata** `metadata.json` | `metadata` | Platform tooling |
| **Unified JSON Schema** `unified-jsonschemas.json` | `unified-jsonschema` | API servers/clients |

Design principle: service `.tsp` stays **purely declarative** (types, decorated models). All expansion logic lives in reviewed TypeScript modules called directly by the emitter.

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
│   ├── main.tsp                    Single-import facade (imports everything below)
│   ├── kessel.tsp                  Core types: Assignable, Permission, BoolRelation, Cardinality
│   ├── kessel-extensions.tsp       Platform templates: CascadeDeletePolicy, ResourceAnnotation
│   ├── decorators.tsp              extern dec: @v1Permission, @cascadeDelete, @resourceAnnotation
│   └── aliases.tsp                 Pre-composed aliases: WorkspaceRef
│
├── schema/                       ← SERVICE AUTHORS WORK HERE
│   ├── main.tsp                    Entrypoint — imports lib/main.tsp + all services
│   ├── hbi.tsp                     HBI service (resource + permissions + policies)
│   ├── remediations.tsp            Permissions-only service
│   └── rbac/
│       ├── rbac.tsp                Core RBAC types: Principal, Role, RoleBinding, Workspace
│       └── rbac-extensions.tsp     V1WorkspacePermission template (type definition)
│
├── src/                          ← PLATFORM-OWNED
│   ├── index.ts                    Package entry: $lib, $onEmit, decorators
│   ├── lib.ts                      Emitter library, StateKeys, barrel re-exports
│   ├── emitter.ts                  $onEmit — direct pipeline (no provider registry)
│   ├── expand-v1.ts                V1 permission expansion, delete scaffold, auto-wiring
│   ├── discover-templates.ts       Platform template discovery (AST walking, alias resolution)
│   ├── discover-resources.ts       Resource graph extraction from TypeSpec AST
│   ├── discover-decorated.ts       Cascade policies + annotations from decorator state
│   ├── types.ts                    ResourceDef, RelationBody, ServiceMetadata
│   ├── primitives.ts               ref, subref, or, and, addRelation, hasRelation
│   ├── resource-graph.ts           Mutation-friendly wrapper: ResourceGraph, ResourceHandle
│   ├── utils.ts                    bodyToZed, slotName, getNamespaceFQN, extractParams
│   ├── decorators.ts               Decorator implementations
│   ├── expand-cascade.ts           Cascade-delete expansion
│   ├── generate.ts                 generateSpiceDB, generateMetadata, generateUnifiedJsonSchemas
│   └── safety.ts                   Pre/post-expansion permission expression validation
│
├── test/
│   ├── unit/                       Vitest files (per-module)
│   ├── integration/                Full compile + benchmarks
│   ├── helpers/
│   │   ├── pipeline.ts             compilePipeline() — end-to-end test runner
│   │   └── zed-parser.ts           SpiceDB output parser
│   └── fixtures/
│       └── spicedb-reference.zed   Golden file
│
├── docs/Guide.md                   This file
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
 │  type graph + state maps)    │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  2. Discovery                │
 │  • discoverResources()       │
 │  • discoverV1Permissions()   │
 │  • @cascadeDelete state map  │
 │  • @resourceAnnotation map   │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  3. Auto-wire Permissions    │
 │  wirePermissionRelations()   │
 │  (inject view/update from    │
 │   @v1Permission decorators)  │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  4. Pre-expansion Validation │
 │  local ref/subref checks     │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  5. V1 Permission Expansion  │
 │  expandV1Permissions()       │
 │  (7 mutations per permission │
 │   on role/role_binding/      │
 │   workspace)                 │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  6. Delete Scaffold Wiring   │
 │  wireDeleteScaffold()        │
 │  (RBAC delete chain)         │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  7. Cascade-Delete Expansion │
 │  expandCascadeDeletePolicies │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  8. Post-expansion Validation│
 │  cross-type subref checks    │
 │  (strict → compiler errors)  │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  9. Generate + Emit          │
 │  spicedb | metadata |        │
 │  unified-jsonschema          │
 └─────────────────────────────┘
```

**Key split:** `generateMetadata` uses **pre-expansion** resources + permission data. `generateSpiceDB` and `generateUnifiedJsonSchemas` use the **post-expansion** `fullSchema`.

### The 7 mutations per V1 permission

When a service declares `@v1Permission("inventory", "hosts", "read", "inventory_host_view")`:

| # | Target | What | Example |
|---|--------|------|---------|
| 1–4 | Role | 4 bool relations (hierarchy) | `inventory_any_any`, `inventory_hosts_any`, `inventory_any_read`, `inventory_hosts_read` |
| 5 | Role | Union permission | `inventory_host_view = any_any_any + inventory_any_any + ...` |
| 6 | RoleBinding | Intersection permission | `inventory_host_view = (subject & t_granted->inventory_host_view)` |
| 7 | Workspace | Union permission | `inventory_host_view = t_binding->... + t_parent->...` |

Read-verb permissions are also OR'd into `view_metadata` on Workspace.

### Auto-wired permission relations

The emitter automatically injects permission relations on resource models based on `@v1Permission` decorators:

| Verb | Auto-wired relation |
|------|---------------------|
| `read` | `view = t_workspace->v2Perm` |
| `write` | `update = t_workspace->v2Perm` |
| `create` | `create = t_workspace->v2Perm` |
| `delete` | `delete = t_workspace->v2Perm` |

Service authors declare permissions via decorators; the emitter handles the relation wiring. This means you do **not** need to manually write `view: WorkspacePermission<"...">` or `Permission<SubRef<...>>` properties on your resource model.

---

## 4. DSL surface — what service teams use

### Building blocks (`lib/kessel.tsp`)

| TypeSpec construct | SpiceDB effect |
|---|---|
| `Assignable<Target, Cardinality>` | `relation t_{name}: {target}` |
| `Permission<SubRef<"rel", "sub">>` | `permission {name} = t_{rel}->{sub}` |
| `BoolRelation<Target>` | `relation t_{name}: {target}:*` |

### Pre-composed aliases

| Alias | Expands to | Use for |
|---|---|---|
| `WorkspaceRef` | `Assignable<RBAC.Workspace, Cardinality.ExactlyOne>` | Every service resource's workspace relation |
| `WorkspacePermission<Name>` | `Permission<SubRef<"workspace", Name>>` | Manual permission wiring (usually auto-wired instead) |

### Cardinality

| Cardinality | Meaning | JSON Schema effect |
|---|---|---|
| `ExactlyOne` | Required, single value | `{name}_id` field, required |
| `AtMostOne` | Optional, single value | `{name}_id` field, optional |
| `AtLeastOne` | Required, one or more | Array, minItems: 1 |
| `Any` | Optional, zero or more | Array |
| `All` | Wildcard (`principal:*`) | N/A |

### Decorators

| Decorator | Apply to | Purpose |
|-----------|----------|---------|
| `@v1Permission(app, res, verb, v2)` | Model | Registers a V1 workspace permission; triggers 7 RBAC mutations + auto-wires relation on the resource |
| `@cascadeDelete(parentRelation)` | Model | Wires `delete` permission through parent relation; app/resource inferred from namespace/model name |
| `@resourceAnnotation(key, value)` | Model | Key/value metadata in `metadata.json`; no SpiceDB effect; app/resource inferred |

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
import "../lib/main.tsp";

using Kessel;

namespace Notifications;

@v1Permission("notifications", "notifications", "read", "notifications_notification_view")
@v1Permission("notifications", "notifications", "write", "notifications_notification_update")
model NotificationsPermissions {}
```

Wire it in `schema/main.tsp`:

```typespec
import "./notifications.tsp";
```

Compile:

```bash
npm run build && npx tsp compile schema/main.tsp
```

**Effort: 1 file, ~12 lines, zero TypeScript.**

### Add a full resource type

Create `schema/content-sources.tsp`:

```typespec
import "@typespec/json-schema";
import "../lib/main.tsp";

using JsonSchema;
using Kessel;

namespace ContentSources;

@jsonSchema
model TemplateData {
  @maxLength(255) name?: string;
  @format("uri") repository_url?: string;
}

@v1Permission("content_sources", "templates", "read", "content_sources_template_view")
@v1Permission("content_sources", "templates", "write", "content_sources_template_edit")
@cascadeDelete("workspace")
@resourceAnnotation("retention_days", "365")
model Template {
  workspace: WorkspaceRef;
  data: TemplateData;
}
```

The emitter auto-wires `view` and `update` relations from the `@v1Permission` decorators.

SpiceDB output:
```
definition content_sources/template {
    permission workspace = t_workspace
    permission view = t_workspace->content_sources_template_view
    permission update = t_workspace->content_sources_template_edit
    permission delete = t_workspace->delete
    relation t_workspace: rbac/workspace
}
```

**Effort: 1 file, ~25 lines, zero TypeScript.**

### Step-by-step checklist

1. **Choose shape:** permissions-only (decorated empty model) vs. resource types + data + policies.
2. **Add** `schema/<your-service>.tsp`.
3. **Import:** `import "../lib/main.tsp";` — one import brings in everything.
4. **Register permissions:** `@v1Permission(app, resource, verb, v2Perm)` on a model.
5. **Define resource** (if any): model with `workspace: WorkspaceRef` and `data: YourData`.
6. **Optional:** `@cascadeDelete("workspace")` for cascade delete; `@resourceAnnotation(key, value)` for metadata.
7. **Wire:** `import "./<your-service>.tsp";` in `schema/main.tsp`.
8. **Verify:** `npm run build && npx tsp compile schema/main.tsp`.

---

## 6. Extension types

| Extension | Mechanism | Params | Mutations |
|-----------|-----------|--------|-----------|
| V1 workspace permission | `@v1Permission` decorator | 4 | 7 + auto-wired relation |
| Cascade delete | `@cascadeDelete` decorator | 1 | 1 |
| Resource annotation | `@resourceAnnotation` decorator | 2 | 0 (metadata only) |

### Future extensions (not yet implemented)

The production `rbac-config` has extension types beyond V1 permissions:

| KSL extension | Purpose | TypeSpec equivalent |
|---|---|---|
| `add_v1_based_permission` | V1 → workspace permission | `@v1Permission` (implemented) |
| `add_contingent_permission` | Intersects two workspace perms | Planned |
| `expose_host_permission` | Passes workspace perm to host | Planned |

---

## 7. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer 1: Schema (.tsp)                                               │
│ lib/*.tsp — types, decorators, aliases                                │
│ schema/*.tsp — service declarations, RBAC types                       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────────┐
│ Layer 2: Emitter pipeline (src/)                                      │
│ emitter.ts — orchestrates discovery → expansion → generation          │
│ expand-v1.ts — V1 permission expansion + delete scaffold              │
│ expand-cascade.ts — cascade-delete from @cascadeDelete                │
│ discover-resources.ts, discover-decorated.ts — AST extraction          │
│ safety.ts — pre/post-expansion validation                              │
│ generate.ts — SpiceDB, metadata, JSON Schema output                    │
└─────────────────────────────────────────────────────────────────────┘
```

The emitter calls expansion functions directly — there is no provider registry or abstraction layer between the emitter and the expansion logic. This keeps the pipeline simple and inspectable.

---

## 8. Testing and CI

### Running tests

```bash
npx vitest run              # full suite
npx vitest run test/unit
npx vitest run test/integration
```

Key test files: `expand.test.ts` (V1 expansion + cascade), `discover.test.ts` (decorator discovery), `benchmark.test.ts` (golden file comparison), `declarative-extensions.test.ts` (integration).

### CI (`.github/workflows/schema-ci.yml`)

Single job `build-and-test`:

1. `npm ci`
2. `npm run build`
3. `npx vitest run`
4. `npx tsp compile schema/main.tsp` (SpiceDB)
5. `tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata`

---

## 9. Design decisions

### Why decorators for everything

All service-facing extension points use decorators (`@v1Permission`, `@cascadeDelete`, `@resourceAnnotation`). Decorators integrate naturally with TypeSpec — they're the standard mechanism for attaching metadata to models. The emitter reads decorator state maps directly.

### Why auto-wire permission relations

In earlier versions, service authors had to manually write `view: WorkspacePermission<"inventory_host_view">` on their resource model — duplicating information already in the `@v1Permission` decorator. The emitter now auto-injects these relations, mapping verb to relation name (`read` → `view`, `write` → `update`, etc.). This matches how TS-POC and Starlark work: `create_v1_based_workspace_permission()` returns an accessor; the wiring is internal.

### Why no provider registry

The original design used a `KesselProvider` interface, a provider registry, and `defineProvider<T>()` to generalize expansion logic. With only one expansion pattern (V1 permissions), this added abstraction without value. The emitter now calls `expandV1Permissions()` and `wireDeleteScaffold()` directly — the same way it calls `expandCascadeDeletePolicies()`. If additional expansion patterns emerge, a registry can be reintroduced with the benefit of concrete examples.

### Why three separate output formats

All three POCs (TypeSpec, Starlark, CUE) produce the same three standalone outputs. A bundled IR was removed because it added complexity without value over running `tsp compile` with different `output-format` options.

---

## 10. Summary: what each role does

| Task | Who | Files touched | TypeScript? |
|---|---|---|---|
| New permissions-only service | Service team | 1 new `.tsp` + 1 import in `main.tsp` | No |
| New resource type | Service team | 1 `.tsp` file | No |
| New data fields | Service team | Edit `*Data` model | No |
| Cascade/annotation | Service team | Decorators on model | No |
| New expansion logic | Platform team | `src/expand-*.ts` + `src/emitter.ts` | Yes |
