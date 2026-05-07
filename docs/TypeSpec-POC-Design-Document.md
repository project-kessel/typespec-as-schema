# TypeSpec-as-Schema: Design Document

**Scope:** `v2/typespec-as-schema` — current implementation.

---

## What This Does

Service teams write `.tsp` files to declare their resources and permissions. A TypeScript emitter compiles them into four outputs: SpiceDB schema, per-service metadata, unified JSON Schema, and a bundled IR for Go consumers.

---

## What Service Teams Write

### Register a permission (one alias):

```typespec
alias viewPermission = Kessel.V1WorkspacePermission<
  "inventory", "hosts", "read", "inventory_host_view"
>;
```

This single line triggers 7 mutations across Role, RoleBinding, and Workspace. No TypeScript changes needed.

### Define a resource model:

```typespec
model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;
}
```

### Define data fields (for unified JSON Schema):

```typespec
@format("uuid")
scalar UuidString extends string;

model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;

  @format("uuid") subscription_manager_id?: string;
  satellite_id?: UuidString | SatelliteNumericId;
  @maxLength(255) ansible_host?: string;
}
```

---

## End-to-End Flow

```
    schema/main.tsp ──imports──▶ ../providers/rbac/rbac.tsp, hbi.tsp, remediations.tsp
              │                  lib/kessel.tsp, lib/kessel-extensions.tsp
              │
              ▼
    ┌─────────────────────────────────────────────────────────┐
    │  STEP 1: COMPILE                                        │
    │  TypeSpec compiler parses all .tsp files into            │
    │  a typed Program (AST + resolved type graph).            │
    └───────────────────────┬─────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
    ┌───────────────────┐       ┌───────────────────┐
    │  STEP 2a: DISCOVER│       │  STEP 2b: DISCOVER│
    │  RESOURCES        │       │  PLATFORM + IR    │
    │  (discover.ts)    │       │  (discover.ts)    │
    │                   │       │                   │
    │  Walk all models. │       │  Walk all models. │
    │  Find Assignable, │       │  discoverExtension │
    │  Permission,      │       │  Instances for     │
    │  BoolRelation     │       │  providers; find   │
    │  properties       │       │  platform          │
    │  → ResourceDef[]  │       │  CascadeDelete +   │
    └────────┬──────────┘       │  annotations.      │
             │                  │  → AnnotationMap   │
             │                  │  → CascadeEntry[]  │
             │                  └────────┬──────────┘
             └──────────┬────────────────┘
                        ▼
    ┌─────────────────────────────────────────────────────────┐
    │  STEP 3: PROVIDER EXPANSION LOOP  (pipeline.ts)         │
    │                                                         │
    │  Provider expansion loop — for each registered           │
    │  ExtensionProvider:                                      │
    │    • discover (template instances from AST)            │
    │    • expand (bounded mutations on scaffold)            │
    │                                                         │
    │  RBAC V1 workspace permissions live in:                 │
    │    providers/rbac/rbac-provider.ts                      │
    │    (same 7 mutations per extension as before: Role/     │
    │     RoleBinding/Workspace; view_metadata OR for reads)  │
    │                                                         │
    │  src/expand.ts: only generic cascade-delete wiring:     │
    │    expandCascadeDeletePolicies — RBAC chain + child     │
    │      Role:        delete = any_any_any                  │
    │      RoleBinding: delete = subject & t_granted->delete  │
    │      Workspace:   delete = t_binding->delete            │
    │                          + t_parent->delete             │
    │      Child:       delete = t_{parent}->delete           │
    │                                                         │
    │  Bool dedup: inventory_any_any added once even if       │
    │  both inv_host_view and inv_host_update request it.     │
    └───────────────────────┬─────────────────────────────────┘
                            │
                            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  STEP 3b: VALIDATE  (safety.ts)                         │
    │  • Per-provider complexity budgets                      │
    │  • Per-provider / global expansion timeouts             │
    │  • Permission expression validation                     │
    │  • Output size limits                                   │
    └───────────────────────┬─────────────────────────────────┘
                            │
                            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  STEP 4: GENERATE + EMIT  (generate.ts → emitter)       │
    │                                                         │
    │  The enriched ResourceDef[] feeds four generators:      │
    │                                                         │
    │  ┌──────────────────┐  ┌──────────────────┐            │
    │  │ generateSpiceDB  │  │ generateMetadata │            │
    │  │ → .zed text      │  │ → per-service    │            │
    │  │   (default)      │  │   perms+resources│            │
    │  └──────────────────┘  └──────────────────┘            │
    │  ┌──────────────────┐  ┌──────────────────┐            │
    │  │ generateUnified  │  │ generateIR       │            │
    │  │ JsonSchemas      │  │ → all-in-one     │            │
    │  │ → _id fields for │  │   JSON bundle    │            │
    │  │   ExactlyOne rels│  │                  │            │
    │  └──────────────────┘  └──────────────────┘            │
    └─────────────────────────────────────────────────────────┘
```

---

## Concrete Example: `inventory_host_view`

Starting point — `schema/hbi.tsp`:

```typespec
alias viewPermission = Kessel.V1WorkspacePermission<"inventory", "hosts", "read", "inventory_host_view">;
```

**Discover:** extracts `{app: "inventory", res: "hosts", verb: "read", v2: "inventory_host_view"}`.

**Expand:** makes 7 mutations:

| # | Target | Result |
|---|--------|--------|
| 1 | Role | `inventory_any_any: rbac/principal:*` |
| 2 | Role | `inventory_hosts_any: rbac/principal:*` |
| 3 | Role | `inventory_any_read: rbac/principal:*` |
| 4 | Role | `inventory_hosts_read: rbac/principal:*` |
| 5 | Role | `inventory_host_view = any_any_any + inventory_any_any + inventory_hosts_any + inventory_any_read + inventory_hosts_read` |
| 6 | RoleBinding | `inventory_host_view = (subject & t_granted->inventory_host_view)` |
| 7 | Workspace | `inventory_host_view = t_binding->inventory_host_view + t_parent->inventory_host_view` |

Because `verb === "read"`, `inventory_host_view` is collected for `view_metadata`.

---

## Outputs

### SpiceDB/Zed (default)

```
definition rbac/principal {}

definition rbac/role {
    permission any_any_any = t_any_any_any
    permission inventory_host_view = any_any_any + inventory_any_any + ...
    permission delete = any_any_any
    relation t_any_any_any: rbac/principal:*
    ...
}

definition rbac/role_binding {
    permission inventory_host_view = (subject & t_granted->inventory_host_view)
    permission delete = (subject & t_granted->delete)
    ...
}

definition rbac/workspace {
    permission view_metadata = inventory_host_view + remediations_remediation_view
    permission inventory_host_view = t_binding->inventory_host_view + t_parent->inventory_host_view
    permission delete = t_binding->delete + t_parent->delete
    ...
}

definition inventory/host {
    permission view = t_workspace->inventory_host_view
    permission update = t_workspace->inventory_host_update
    permission delete = t_workspace->delete
    relation t_workspace: rbac/workspace
}
```

### Metadata JSON (`--metadata`)

```json
{
  "inventory": { "permissions": ["inventory_host_view", "inventory_host_update"], "resources": ["host"] },
  "remediations": { "permissions": ["remediations_remediation_view", "remediations_remediation_update"], "resources": [] }
}
```

### IR JSON (`--ir`)

Bundles everything into one file for Go consumers:

```json
{
  "version": "1.2.0",
  "resources": [ /* expanded ResourceDef[] */ ],
  "extensions": { /* Record<string, unknown[]> — per-provider sections */ },
  "spicedb": "definition rbac/principal { ... }",
  "metadata": { /* per-service */ },
  "jsonSchemas": { /* unified JSON Schema fragments */ },
  "annotations": { /* optional key-value metadata per resource */ }
}
```

---

## Adding a New Service

**1. Create `schema/notifications.tsp`:**

```typespec
import "../lib/kessel.tsp";
import "../providers/rbac/rbac-extensions.tsp";
import "../providers/rbac/rbac.tsp";

using Kessel;
namespace Notifications;

alias viewPermission = Kessel.V1WorkspacePermission<
  "notifications", "notifications", "read", "notifications_notification_view"
>;

model Notification {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  view: Permission<"workspace.notifications_notification_view">;
}
```

**2. Add one import to `schema/main.tsp`:**

```typespec
import "./notifications.tsp";
```

**3. Run:**

```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp
```

No TypeScript changes needed.

---

## Source Files

| File | Lines | What it does |
|------|-------|-------------|
| `src/types.ts` | 71 | Core interfaces: `ResourceDef`, `RelationBody`, `UnifiedJsonSchema`, `IntermediateRepresentation`, `AnnotationEntry`, and related IR shapes |
| `src/utils.ts` | 66 | Shared helpers: `getNamespaceFQN`, `camelToSnake`, `bodyToZed`, `slotName`, `flattenAnnotations`, `findResource`, `cloneResources`, `isAssignable` |
| `src/parser.ts` | 157 | Recursive-descent parser for SpiceDB permission expression strings |
| `src/registry.ts` | — | `buildRegistry(providers)` + `PLATFORM_TEMPLATES`; wires template metadata for the pipeline |
| `src/discover.ts` | — | Resource discovery + `discoverExtensionInstances` for providers; platform cascade/annotation discovery |
| `src/expand.ts` | — | Generic cascade-delete expansion only (`expandCascadeDeletePolicies`); no provider-specific RBAC math |
| `src/pipeline.ts` | — | Provider-driven orchestration: compile → discover → per-provider discover/expand loop → validate → generate |
| `src/provider.ts` | — | `ExtensionProvider` interface and provider contract |
| `src/primitives.ts` | — | Platform builtins: `ref`, `subref`, `or`, `and`, `addRelation`, etc. |
| `src/generate.ts` | 160 | Output generators: SpiceDB, JSON Schema, metadata, IR |
| `src/safety.ts` | — | Per-provider complexity budgets, timeouts, output size, expression validation |
| `src/lib.ts` | 59 | Barrel module re-exporting all public API |
| `src/spicedb-emitter.ts` | 156 | CLI entry point: parses flags, calls `compilePipeline`, emits the requested output format |
| `providers/rbac/rbac-provider.ts` | — | RBAC `ExtensionProvider`: V1 workspace permission expansion (7 bounded mutations, scaffold wiring) |
| `providers/rbac/rbac.tsp` | — | RBAC types (moved from `schema/rbac.tsp`) |
| `providers/rbac/rbac-extensions.tsp` | — | `V1WorkspacePermission` template and RBAC extension surface for services |
| `lib/kessel-extensions.tsp` | — | `CascadeDeletePolicy` + `ResourceAnnotation` only |
| **Total** | **~1600+** | |

### Commands

```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp                         # SpiceDB output
npx tsx src/spicedb-emitter.ts schema/main.tsp --metadata              # Service metadata
npx tsx src/spicedb-emitter.ts schema/main.tsp --unified-jsonschema    # JSON Schema
npx tsx src/spicedb-emitter.ts schema/main.tsp --ir                    # IR for Go consumer
npx tsx src/spicedb-emitter.ts schema/main.tsp --preview <v2perm>      # Preview extension mutations
npx vitest run                                                         # 203 tests
```

---

## Go Consumer Path

```
.tsp files → TypeSpec compile → emitter --ir → resources.json → go:embed → Go structs
```

Go runtime loads the pre-built IR. No Node.js dependency at runtime.

---

## Extension Safety: Structural Guarantees

### The Problem

Schema compilation runs inside Kessel Inventory. A malformed or adversarial schema
that causes unbounded computation could escalate into service downtime. Runtime
limits (timeouts, step counts) are a necessary minimum, but they only detect
the problem — a schema that always times out is still broken until someone fixes it.

The ideal is **prevention**: an architecture where user-authored schema cannot
cause unbounded computation in the first place.

### TypeSpec's Structural Advantage

TypeSpec separates **declarative schema** (what service teams write) from
**provider-owned expansion** (reviewed TypeScript shipped with each extension
family) and **platform orchestration** (budgets, timeouts, neutral pipeline).
This creates a three-layer trust boundary:

```
  Service authors write:        Providers own:                Platform orchestrates:
  schema/*.tsp                  providers/rbac/               src/pipeline.ts
  (alias declarations,          rbac-provider.ts              (discover → expand loop,
   model definitions)           (7 bounded mutations,          per-provider budgets,
                                  scaffold wiring)              expansion timeout)
  Zero computation.             Reviewed, bounded,            Provider-neutral
  Only type declarations.       cost-declared.                orchestration.
```

**Unchanged for services:** Authors still write zero computation—only `.tsp` aliases, models, and annotations.

**What service authors can do:**
- Declare `V1WorkspacePermission` aliases (zero computation — type declaration only)
- Declare `ResourceAnnotation` aliases (zero computation — metadata only)
- Declare `CascadeDeletePolicy` aliases (zero computation — adds delete permission)
- Define resource models with `Assignable`, `Permission`, `BoolRelation` properties
- Define data fields inline on flat resource models using standard validation decorators

**What service authors cannot do:**
- Write loops, recursion, or arbitrary logic
- Call functions that mutate schema state
- Register new expansion providers or bypass review
- Execute arbitrary user code during compilation

**What providers (e.g. RBAC) ship:** Reviewed expansion code with declared cost
budgets; bounded mutation sets (such as the 7-step V1 permission expansion);
no arbitrary computation in service `.tsp` files.

**What the platform guarantees:** It runs the provider loop under per-provider
complexity budgets and timeouts; orchestration stays provider-neutral.

**Why this matters:** For N RBAC-style extensions, work stays linear in N (e.g. 7N
mutations plus `view_metadata` accumulation for that provider). Runtime guards still
catch bugs or regressions in provider code without service teams running computation
in schema sources.

### Comparison with Other Candidates

| Property | TypeSpec | TypeScript (goja) | Starlark | CUE |
|---|---|---|---|---|
| User code in schema? | **No** | Yes — arbitrary TS | Yes — arbitrary Starlark | Limited — declarative but recursive |
| Extension logic | Provider-owned expansion (e.g. `rbac-provider.ts`), platform orchestrates | User-written functions | User-written functions + Go builtins | Unification (automatic) |
| Computation bound | Per-provider declared budgets; linear for bounded providers | Unbounded — user code | Unbounded — user code | Unbounded — recursive unification |
| Time limits | Per-provider + process timeouts | `runtime.Interrupt()` | `SetMaxExecutionSteps()` | None built-in |
| Memory limits | `--max-old-space-size` | None | None | None |
| Recovery model | Fix provider (reviewed) or platform orchestration; services stay declarative | Fix user's schema (their team) | Fix user's schema (their team) | Fix user's schema (their team) |

### Defense-in-Depth: Runtime Safeguards

Even with structural prevention, the emitter includes runtime guards in `src/safety.ts`:

| Guard | Stage | What it catches |
|---|---|---|
| **Complexity budget** | Pre-expansion | Too many extensions per provider (defaults vary by provider) |
| **Expansion timeout** | During expansion | Bugs in provider expansion code or runaway loops (per-provider / global limits) |
| **Output size limit** | Post-generation | Combinatorial explosion (warn >100KB, error >1MB) |
| **Permission expression validation** | Post-expansion | Typos, stale references, and cross-type subref mismatches in `Permission<"expr">` strings |

These guards fail fast with actionable diagnostics. The complexity budget
prevents expansion from starting; the timeout catches bugs in expansion code;
the output size limit catches unexpected growth.

### Adding New Extension Types (Providers)

A new extension family is a **provider**, not a single template edit in platform
`expand.ts`. Platform team review is required before registration.

1. Add a new `.tsp` template under the provider's directory (declarative aliases
   and types only).
2. Implement `ExtensionProvider` in TypeScript (reviewed discovery + bounded
   expansion, with declared cost metadata).
3. Register the provider in `pipeline.ts` (and wire `buildRegistry` / templates
   as needed).
4. Service authors instantiate the template via aliases in `schema/*.tsp` only;
   they still write zero computation.

This keeps service schema declarative while allowing multiple independently reviewed
expansion backends. A generic user-authored rule engine in `.tsp` would still break
the same structural guarantee as before.

## IR Contract

The Intermediate Representation (IR) is the contract between the TypeSpec emitter
(TypeScript) and downstream consumers (Go loader, CI tooling, etc.).

**Current version:** `1.2.0` (defined as `IR_VERSION` in `src/types.ts`)

### Field Semantics

| Field | Type | Description |
|---|---|---|
| `version` | `string` | Semver IR format version. Bump minor for additive changes, major for breaking. |
| `generatedAt` | `string` | ISO 8601 timestamp of generation (non-deterministic, excluded from diff). |
| `source` | `string` | Schema-root-relative path to the compiled `.tsp` entry point (e.g. `schema/main.tsp`). |
| `resources` | `ResourceDef[]` | Expanded resource definitions including RBAC scaffold mutations. |
| `extensions` | `Record<string, unknown[]>` | Per-provider sections of discovered extension instances (shape defined by each provider; e.g. RBAC entries under that provider's key). |
| `spicedb` | `string` | Generated SpiceDB/Zed schema text. |
| `metadata` | `Record<string, ServiceMetadata>` | Per-application service metadata (permissions, resources, cascade policies, annotations). |
| `jsonSchemas` | `Record<string, UnifiedJsonSchema>` | Generated JSON schemas for ExactlyOne assignable relations. |
| `annotations` | `Record<string, Record<string, string>>` | Optional. Flattened resource annotations keyed by `application/resource`. |

### Contract Rules

1. The Go struct in `go-loader-example/schema/types.go` must stay in sync with
   the TypeScript `IntermediateRepresentation` interface in `src/types.ts`.
2. New fields must use `omitempty` in Go and `?` in TypeScript for backward compatibility.
3. The `version` field must be bumped when the IR shape changes.
