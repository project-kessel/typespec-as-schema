# TypeSpec-as-Schema: Architecture Guide

**Scope:** `typespec-as-schema/` — Kessel schema tooling that uses TypeSpec as the declarative schema language and a **registered emitter plugin** (`$onEmit`) with **custom decorators**.

---

## Table of Contents

1. [Overview](#overview)
2. [Folder Structure](#folder-structure)
3. [Architecture Layers](#architecture-layers)
4. [Core Types](#core-types)
5. [RBAC helper types (`rbac-provider.ts`)](#rbac-helper-types-rbac-providerts)
6. [Code Flow: Compile to Emit](#code-flow-compile-to-emit)
7. [The DSL Surface (What Service Teams Write)](#the-dsl-surface-what-service-teams-write)
8. [Custom Decorators](#custom-decorators)
9. [RBAC permission expansion](#rbac-permission-expansion)
10. [Output generators](#output-generators)
11. [Validation and safety](#validation-and-safety)
12. [Test architecture](#test-architecture)
13. [CI / build / scripts](#ci--build--scripts)
14. [Extension points](#extension-points)

---

## Overview

Service teams write `.tsp` files to declare resources, permissions, and metadata. A **TypeSpec emitter plugin** (`$onEmit` in `src/emitter.ts`) compiles those declarations into:

- **SpiceDB / Zed** (`schema.zed`)
- **Service metadata JSON** (`metadata.json`)
- **Unified JSON Schemas** (`unified-jsonschemas.json`)

**Entry point (`src/index.ts`):** exports `$lib`, `$onEmit`, and decorator implementations `$kesselExtension`, `$cascadePolicy`, `$annotation`.

**Emitter options** (see `src/lib.ts`, `tspconfig.yaml`, or `--option`):

| Option | Purpose |
|--------|---------|
| `output-format` | `spicedb` \| `metadata` \| `unified-jsonschema` (default `spicedb`) |
| `strict` | If `true`, post-expansion permission validation failures are reported as errors |

Design direction: service `.tsp` stays declarative (types, aliases, decorated models). **Deterministic expansion** (RBAC permissions, cascade-delete wiring) lives in reviewed TypeScript (`src/providers/rbac/rbac-provider.ts`, `src/expand-cascade.ts`), orchestrated by the emitter pipeline below — **not** by ad-hoc logic in schema files.

---

## Folder Structure

```
typespec-as-schema/
├── lib/                          # Platform DSL library (.tsp)
│   ├── kessel.tsp                # Core types: Assignable, Permission, BoolRelation, etc.
│   ├── kessel-extensions.tsp    # CascadeDeletePolicy, ResourceAnnotation templates
│   └── decorators.tsp            # extern dec (@kesselExtension, @cascadePolicy, @annotation)
│
├── schema/                       # Example / product schema (.tsp)
│   ├── main.tsp                  # Unification entrypoint — imports services
│   ├── hbi.tsp                   # Example: Host resource + data + permissions + policies
│   ├── remediations.tsp          # Example: permissions-oriented shapes
│   └── rbac/
│       ├── rbac.tsp              # RBAC types: Principal, Role, RoleBinding, Workspace
│       └── rbac-extensions.tsp   # V1WorkspacePermission template (Kessel namespace)
│
├── src/                          # Emitter plugin (TypeScript)
│   ├── index.ts                  # Exports $lib, $onEmit, $kesselExtension, $cascadePolicy, $annotation
│   ├── lib.ts                    # $lib, StateKeys, KesselEmitterOptions, re-exports
│   ├── emitter.ts                # $onEmit — discover → validate → expand → validate → emit
│   ├── types.ts                  # ResourceDef, RelationBody, metadata/schema DTOs
│   ├── primitives.ts             # ref, subref, or, and, addRelation, hasRelation
│   ├── utils.ts                  # bodyToZed, slotName, getNamespaceFQN, etc.
│   ├── decorators.ts             # JS implementations for lib/decorators.tsp
│   ├── discover-resources.ts    # discoverResources — resource graph
│   ├── discover-decorated.ts    # Cascade policies + annotations from decorator state
│   ├── expand-cascade.ts        # Cascade-delete permission expansion
│   ├── generate.ts               # generateSpiceDB, generateMetadata, generateUnifiedJsonSchemas
│   ├── safety.ts                 # Pre/post-expansion permission expression validation
│   └── providers/rbac/
│       └── rbac-provider.ts      # V1 template discovery + RBAC graph expansion + delete scaffold
│
├── test/
│   ├── unit/                     # 11 Vitest files (per-module)
│   ├── integration/              # 2 files: full compile + benchmarks
│   ├── helpers/
│   │   └── zed-parser.ts         # SpiceDB output parsing for tests
│   └── fixtures/
│       └── spicedb-reference.zed # Golden Zed for comparisons
│
├── docs/                         # Documentation (including this file)
├── samples/                      # Optional captured demo output
├── scripts/                      # e.g. validate-spicedb.sh, test-permissions.sh
├── .github/workflows/
│   └── schema-ci.yml             # build-and-test (see CI section)
├── package.json
├── tsconfig.build.json
├── tspconfig.yaml
├── Makefile
├── docker-compose.yaml
└── README.md
```

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Schema (.tsp)                                                  │
│ schema/*.tsp, lib/*.tsp — declarations, aliases, decorators             │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────┐
│ Layer 2: Domain expansion (reviewed TS)                                 │
│ rbac-provider.ts — V1WorkspacePermission discovery + RBAC mutations      │
│ expand-cascade.ts — cascade-delete permissions from CascadeDeleteEntry[]  │
└──────────────────────────────────┬──────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼──────────────────────────────────────┐
│ Layer 3: Emitter orchestration                                          │
│ emitter.ts — ordering: discover → pre-validate → RBAC expand →          │
│   scaffold → cascade expand → post-validate → generate                   │
│ discover-*.ts, generate.ts, safety.ts                                      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Types

Defined in **`src/types.ts`** (and re-exported from `src/lib.ts`):

### RelationBody (discriminated union)

Maps to SpiceDB/Zed permission/relation shapes:

```typescript
type RelationBody =
  | { kind: "assignable"; target: string; cardinality: string }
  | { kind: "bool"; target: string }
  | { kind: "ref"; name: string }
  | { kind: "subref"; name: string; subname: string }
  | { kind: "or"; members: RelationBody[] }
  | { kind: "and"; members: RelationBody[] };
```

### RelationDef

```typescript
interface RelationDef { name: string; body: RelationBody; }
```

### ResourceDef

```typescript
interface ResourceDef {
  name: string;
  namespace: string;
  relations: RelationDef[];
}
```

### UnifiedJsonSchema

Shape used for **`generateUnifiedJsonSchemas`** output values (UUID `_id` fields for `ExactlyOne` assignables).

### CascadeDeleteEntry / AnnotationEntry

```typescript
interface CascadeDeleteEntry {
  childApplication: string;
  childResource: string;
  parentRelation: string;
}

interface AnnotationEntry { key: string; value: string; }
```

### ServiceMetadata

Per-application aggregate for **`metadata.json`**:

```typescript
interface ServiceMetadata {
  permissions: string[];
  resources: string[];
  cascadeDeletePolicies?: string[];
  annotations?: Record<string, string>;
}
```

---

## RBAC helper types (`rbac-provider.ts`)

**`V1Extension`** — one discovered `V1WorkspacePermission` instance (application, resource, verb, v2 permission name). Used as input to RBAC expansion and to populate metadata permission lists.

**`ExpansionResult`** / **`DiscoveryStats`** / **`DiscoveryWarnings`** — helpers for expansion and discovery diagnostics returned or logged from RBAC logic.

**`ValidationDiagnostic`** — defined in **`src/safety.ts`** (resource key, relation name, expression snippet, message).

---

## Code Flow: Compile to Emit

`tsp compile` loads the program; **`$onEmit`** (`src/emitter.ts`) runs the pipeline:

1. **Discover** — `discoverResources`, `discoverV1Permissions`, `discoverDecoratedCascadePolicies`, `discoverDecoratedAnnotations`
2. **Pre-validate** — `validatePreExpansionExpressions(resources)` (`safety.ts`)
3. **RBAC expand** — `expandV1Permissions(resources, permissions)`
4. **Scaffold** — `wireDeleteScaffold(afterRbac)` (delete chain on RBAC types for cascade)
5. **Cascade expand** — `expandCascadeDeletePolicies(scaffolded, cascadePolicies)` → `fullSchema`
6. **Post-validate** — `validatePermissionExpressions(fullSchema)`; if `strict`, diagnostics become errors
7. **Generate** — branch on `output-format`

```
schema/main.tsp  →  TypeSpec Program
                           │
                           ▼
              ┌────────────────────────────┐
              │ Discover (four passes)      │
              │ • Resource graph           │
              │ • V1 permissions (RBAC)    │
              │ • @cascadePolicy models    │
              │ • @annotation models       │
              └─────────────┬──────────────┘
                            ▼
              ┌────────────────────────────┐
              │ Pre-expansion validation    │
              └─────────────┬──────────────┘
                            ▼
              ┌────────────────────────────┐
              │ RBAC + scaffold + cascade   │
              │ → fullSchema (expanded)     │
              └─────────────┬──────────────┘
                            ▼
              ┌────────────────────────────┐
              │ Post-expansion validation   │
              └─────────────┬──────────────┘
                            ▼
              ┌────────────────────────────┐
              │ Emit spicedb | metadata |   │
              │      unified-jsonschema     │
              └────────────────────────────┘
```

**Important split:**

- **`generateMetadata`** is called with **pre-expansion** `resources`, plus `permissions`, `annotations`, `cascadePolicies` — **not** `fullSchema`.
- **`generateSpiceDB`** and **`generateUnifiedJsonSchemas`** use **`fullSchema`** (fully expanded graph).

Owned namespaces (e.g. `"rbac"`) are skipped where appropriate for metadata and unified JSON Schema (see `emitter.ts`).

---

## The DSL Surface (What Service Teams Write)

### `lib/kessel.tsp` — core relation primitives

| Type | Role |
|------|------|
| `Assignable<Target, Card>` | Direct relation |
| `BoolRelation<Target>` | Wildcard subject side |
| `Permission<Expr>` | Derived permission |
| `Ref` / `SubRef` / `Or` / `And` | Expression combinators |
| `Cardinality` | `AtMostOne`, `ExactlyOne`, etc. |

### `lib/kessel-extensions.tsp` — platform templates

| Template | Role |
|----------|------|
| `CascadeDeletePolicy<...>` | Declares parent/child cascade; expansion updates child `delete` permission |
| `ResourceAnnotation<...>` | Declarative key/value metadata; picked up via `@annotation` for **metadata.json** |

### `lib/decorators.tsp`

| Decorator | Role |
|-----------|------|
| `@kesselExtension` | Populates `StateKeys.kesselExtension` (see [Custom decorators](#custom-decorators)) |
| `@cascadePolicy` | Marks a `CascadeDeletePolicy` model for discovery |
| `@annotation` | Marks a `ResourceAnnotation` model for discovery |

### `schema/rbac/` — RBAC template

`V1WorkspacePermission<App, Res, Verb, V2>` — registers a v1-style permission; **`discoverV1Permissions`** finds instances by **template / alias walking**, not via `@kesselExtension`.

### Example pattern (`schema/hbi.tsp` illustrates)

- `alias ... = Kessel.V1WorkspacePermission<...>` for RBAC-backed permissions
- `@cascadePolicy` on a `CascadeDeletePolicy` model
- `@annotation` on a `ResourceAnnotation` model
- Resource `model` with `Assignable` / `Permission` fields and optional `@jsonSchema` data models

---

## Custom Decorators

TypeSpec links `extern dec` in **`lib/decorators.tsp`** to **`$`-prefixed** exports from **`src/index.ts`**, implemented in **`src/decorators.ts`**.

Declaration:

```typespec
extern dec kesselExtension(target: Model);
extern dec cascadePolicy(target: Model);
extern dec annotation(target: Model);
```

Each implementation adds the target model to a **compiler state set** (`StateKeys` in `src/lib.ts`). **`discover-decorated.ts`** reads `cascadePolicy` and `annotation` sets.

**`@kesselExtension`** is implemented and tested (state set is populated), but **`discoverV1Permissions` does not use it**. V1 permissions are discovered by walking the program for `V1WorkspacePermission` template instances (models and aliases). Keep `@kesselExtension` usage in schema only if you want the marker for documentation or future wiring; it is not part of current RBAC discovery.

---

## RBAC permission expansion

All logic lives in **`src/providers/rbac/rbac-provider.ts`**.

### `discoverV1Permissions(program)`

Walks the compiled program (e.g. via `navigateProgram`, template matching) to collect **`V1Extension[]`**. Does **not** consult `StateKeys.kesselExtension`.

### `expandV1Permissions(resources, permissions)`

For each extension, applies a **fixed sequence of graph mutations** (the historical “7 mutations” pattern): bool relations and computed permissions on **Role**, **RoleBinding**, and **Workspace**, plus **`view_metadata`** accumulation for read verbs.

### `wireDeleteScaffold(resources)`

Adds delete-related permissions on the RBAC scaffold so cascade-delete expansion can chain through Role / RoleBinding / Workspace.

### `src/primitives.ts`

Helpers used by RBAC (and cascade) code to build **`RelationBody`** values: `ref`, `subref`, `or`, `and`, `addRelation`, `hasRelation`.

### `src/expand-cascade.ts`

Consumes **`CascadeDeleteEntry[]`** from decorated policies and mutates **`ResourceDef[]`** so child `delete` permissions reference the parent relation’s delete permission.

---

## Output generators

All functions live in **`src/generate.ts`**.

| Function | Input graph | Output |
|----------|-------------|--------|
| `generateSpiceDB` | **Expanded** `ResourceDef[]` | Zed text (`schema.zed`) |
| `generateUnifiedJsonSchemas` | **Expanded** `ResourceDef[]` | `Record<string, UnifiedJsonSchema>` → `unified-jsonschemas.json` |
| `generateMetadata` | **Pre-expansion** `resources` + `permissions` + optional `annotations` / `cascadePolicies` | `Record<string, ServiceMetadata>` → `metadata.json` |

Emitter options are defined on **`KesselEmitterOptions`** in **`src/lib.ts`** (`output-format`, `strict`).

---

## Validation and safety

**`src/safety.ts`** only validates **permission expressions** (refs, subrefs, cross-type subrefs after expansion). It does **not** enforce complexity budgets, wall-clock timeouts, or output size caps.

| Pass | When | Purpose |
|------|------|---------|
| `validatePreExpansionExpressions` | After discovery, on initial `resources` | Local refs/subrefs in permission bodies resolve to known relations on the same resource |
| `validatePermissionExpressions` | After full expansion, on `fullSchema` | Cross-resource `subref` targets exist; optionally **strict** errors |

Pre-expansion findings are surfaced as **warnings** on the program today; post-expansion findings honor **`strict`** for error severity.

---

## Test architecture

**Vitest** — **`test/unit/`** (11 files) exercise individual modules (`utils`, `discover-resources`, RBAC expand, `generate`, `safety`, `decorators`, etc.).

**`test/integration/`** (2 files) compiles **`schema/main.tsp`** end-to-end and asserts on outputs or runs benchmarks.

**`test/helpers/zed-parser.ts`** parses Zed for assertions. **`test/fixtures/spicedb-reference.zed`** is a reference artifact for comparisons.

---

## CI / build / scripts

### GitHub Actions (`.github/workflows/schema-ci.yml`)

Single job **`build-and-test`**:

1. `npm ci`
2. `npm run build`
3. `npx vitest run`
4. `npx tsp compile schema/main.tsp` (default **SpiceDB** output)
5. `tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata`

**unified-jsonschema** is available locally via the same compile with `output-format=unified-jsonschema` but is not a separate CI step today.

### Makefile (representative)

Typical targets include **`build`**, **`compile`**, emit variants, **`demo`**, **`samples`**, **`clean`** — see **`Makefile`** for the authoritative list.

### Scripts and Docker

**`scripts/`** (e.g. `validate-spicedb.sh`, `test-permissions.sh`) and **`docker-compose.yaml`** support local SpiceDB validation workflows.

---

## Extension points

### New service schema

1. Add **`schema/<service>.tsp`**.
2. Import it from **`schema/main.tsp`**.
3. Run **`tsp compile`**; no TypeScript change required for purely declarative additions.

### New decorated platform concept (cascade / annotation style)

1. Add or extend a template in **`lib/kessel-extensions.tsp`** (or appropriate namespace).
2. Declare **`extern dec`** in **`lib/decorators.tsp`** and implement **`$...`** in **`src/decorators.ts`**; export from **`src/index.ts`** if new.
3. Add discovery in **`src/discover-decorated.ts`** (or a dedicated discover module) and wire **`emitter.ts`**.
4. If expansion is needed, implement alongside **`expand-cascade.ts`** or a sibling module and invoke it in **`emitter.ts`** in the right order relative to RBAC.

### New output format

1. Extend **`KesselEmitterOptions["output-format"]`** in **`src/lib.ts`** (schema + TypeScript union).
2. Implement **`generate*`** in **`src/generate.ts`**.
3. Add a **`case`** in **`$onEmit`** (`emitter.ts`).
4. Update **`tspconfig.yaml` / docs / CI** as needed.

### RBAC changes

Prefer editing **`src/providers/rbac/rbac-provider.ts`** and the **`V1WorkspacePermission`** template in **`schema/rbac/`**, then updating tests under **`test/unit/`** and **`test/integration/`**.
