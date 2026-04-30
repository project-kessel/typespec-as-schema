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

### Define data fields (for JSON Schema):

```typespec
@jsonSchema
model HostData {
  @format("uuid") subscription_manager_id?: string;
  satellite_id?: string | SatelliteNumericId;
  @maxLength(255) ansible_host?: string;
}
```

---

## End-to-End Flow

```
    schema/main.tsp ──imports──▶ rbac.tsp, hbi.tsp, remediations.tsp
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
    │  RESOURCES        │       │  EXTENSIONS       │
    │  (discover.ts)    │       │  (discover.ts)    │
    │                   │       │                   │
    │  Walk all models. │       │  Walk all models. │
    │  Find Assignable, │       │  Find V1Workspace │
    │  Permission,      │       │  Permission,      │
    │  BoolRelation     │       │  Annotations,     │
    │  properties       │       │  CascadeDelete    │
    │  → ResourceDef[]  │       │  instances.       │
    │                   │       │  → V1Extension[]  │
    └────────┬──────────┘       │  → AnnotationMap  │
             │                  │  → CascadeEntry[] │
             │                  └────────┬──────────┘
             └──────────┬────────────────┘
                        ▼
    ┌─────────────────────────────────────────────────────────┐
    │  STEP 3: EXPAND                                         │
    │                                                         │
    │  expandV1Permissions (expand.ts):                        │
    │  For each V1Extension, make 7 mutations:                │
    │                                                         │
    │  Role:                                                  │
    │    1. Bool relation  {app}_any_any                      │
    │    2. Bool relation  {app}_{res}_any                    │
    │    3. Bool relation  {app}_any_{verb}                   │
    │    4. Bool relation  {app}_{res}_{verb}                 │
    │    5. Permission     {v2} = any_any_any + all 4 above   │
    │                                                         │
    │  RoleBinding:                                           │
    │    6. Permission     {v2} = subject & t_granted->{v2}   │
    │                                                         │
    │  Workspace:                                             │
    │    7. Permission     {v2} = t_binding->{v2}             │
    │                            + t_parent->{v2}             │
    │                                                         │
    │  After all extensions:                                  │
    │    view_metadata = OR(all read-verb v2 perms)           │
    │                                                         │
    │  expandCascadeDeletePolicies (expand.ts):               │
    │    Wires "delete" through the full RBAC chain:          │
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
    │  • Complexity budget (max extensions)                    │
    │  • Expansion timeout                                    │
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
  "extensions": [ /* V1Extension[] */ ],
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
import "../lib/kessel-extensions.tsp";
import "./rbac.tsp";

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
| `src/types.ts` | 71 | Core interfaces: `ResourceDef`, `RelationBody`, `V1Extension`, `UnifiedJsonSchema`, `IntermediateRepresentation`, `AnnotationEntry`, `RBACScaffold` |
| `src/utils.ts` | 66 | Shared helpers: `getNamespaceFQN`, `camelToSnake`, `bodyToZed`, `slotName`, `flattenAnnotations`, `findResource`, `cloneResources`, `isAssignable` |
| `src/parser.ts` | 157 | Recursive-descent parser for SpiceDB permission expression strings |
| `src/registry.ts` | 17 | Extension template registry: single source of truth for template names, params, and namespaces |
| `src/discover.ts` | 340 | AST walking: resource discovery + extension instance enumeration (V1 perms, annotations, cascade delete) |
| `src/expand.ts` | 218 | Pure expansion math: V1 permission + cascade delete expansion (no TypeSpec imports) |
| `src/pipeline.ts` | 107 | Pipeline orchestration: compile → discover → validate → expand → validate → generate |
| `src/generate.ts` | 160 | Output generators: SpiceDB, JSON Schema, metadata, IR |
| `src/safety.ts` | 277 | Defense-in-depth: complexity budget, timeout, output size, expression validation |
| `src/lib.ts` | 59 | Barrel module re-exporting all public API |
| `src/spicedb-emitter.ts` | 156 | CLI entry point: parses flags, calls `compilePipeline`, emits the requested output format |
| **Total** | **~1600** | |

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
**expansion logic** (what the platform owns). This creates a trust boundary:

```
  Service authors write:              Platform owns:
  ─────────────────────              ──────────────
  schema/*.tsp                       src/expand.ts
  (alias declarations,               (explicit expansion logic,
   model definitions,                 7 bounded mutations
   type annotations)                  per extension)

  Zero computation.                  Deterministic, tested,
  Only type declarations.            O(N) for N extensions.
```

**What service authors can do:**
- Declare `V1WorkspacePermission` aliases (zero computation — type declaration only)
- Declare `ResourceAnnotation` aliases (zero computation — metadata only)
- Declare `CascadeDeletePolicy` aliases (zero computation — adds delete permission)
- Define resource models with `Assignable`, `Permission`, `BoolRelation` properties
- Define data models with `@jsonSchema` decorators

**What service authors cannot do:**
- Write loops, recursion, or arbitrary logic
- Call functions that mutate schema state
- Define custom expansion rules
- Execute code during compilation

**Why this matters:** For N extensions, the total work is exactly 7N mutations
plus one `view_metadata` accumulation. With 1000 extensions, that is 7000 mutations —
still sub-second. There is no path to exponential or unbounded computation
through the schema layer.

### Comparison with Other Candidates

| Property | TypeSpec | TypeScript (goja) | Starlark | CUE |
|---|---|---|---|---|
| User code in schema? | **No** | Yes — arbitrary TS | Yes — arbitrary Starlark | Limited — declarative but recursive |
| Extension logic | Platform-owned `expand.ts` | User-written functions | User-written functions + Go builtins | Unification (automatic) |
| Computation bound | O(N) — 7 mutations per extension | Unbounded — user code | Unbounded — user code | Unbounded — recursive unification |
| Time limits | Process timeout (external) | `runtime.Interrupt()` | `SetMaxExecutionSteps()` | None built-in |
| Memory limits | `--max-old-space-size` | None | None | None |
| Recovery model | Fix platform code (one team) | Fix user's schema (their team) | Fix user's schema (their team) | Fix user's schema (their team) |

### Defense-in-Depth: Runtime Safeguards

Even with structural prevention, the emitter includes runtime guards in `src/safety.ts`:

| Guard | Stage | What it catches |
|---|---|---|
| **Complexity budget** | Pre-expansion | Too many extensions (default limit: 500) |
| **Expansion timeout** | During expansion | Bugs in platform expansion code (default: 10s) |
| **Output size limit** | Post-generation | Combinatorial explosion (warn >100KB, error >1MB) |
| **Permission expression validation** | Post-expansion | Typos, stale references, and cross-type subref mismatches in `Permission<"expr">` strings |

These guards fail fast with actionable diagnostics. The complexity budget
prevents expansion from starting; the timeout catches bugs in expansion code;
the output size limit catches unexpected growth.

### Adding New Extension Templates

New extension templates maintain the structural guarantee:

1. A new TypeSpec template in `lib/kessel-extensions.tsp` (declarative, no computation)
2. A new entry in `src/registry.ts` (template name, param names, namespace)
3. Discovery logic in `src/discover.ts` (AST walking for instances)
4. A new expansion function in `src/expand.ts` (platform-owned, bounded, tested)

Service authors still only instantiate templates. The trust boundary does not move.
This is an explicit tradeoff: explicit expansion functions over a generic
rule engine. A generic engine would move computation into user-authored rules,
losing the structural safety guarantee.

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
| `extensions` | `V1Extension[]` | Discovered V1WorkspacePermission instances (pre-expansion). |
| `spicedb` | `string` | Generated SpiceDB/Zed schema text. |
| `metadata` | `Record<string, ServiceMetadata>` | Per-application service metadata (permissions, resources, cascade policies, annotations). |
| `jsonSchemas` | `Record<string, UnifiedJsonSchema>` | Generated JSON schemas for ExactlyOne assignable relations. |
| `annotations` | `Record<string, Record<string, string>>` | Optional. Flattened resource annotations keyed by `application/resource`. |

### Contract Rules

1. The Go struct in `go-loader-example/schema/types.go` must stay in sync with
   the TypeScript `IntermediateRepresentation` interface in `src/types.ts`.
2. New fields must use `omitempty` in Go and `?` in TypeScript for backward compatibility.
3. The `version` field must be bumped when the IR shape changes.
