# TypeSpec-as-Schema: Design Document

**Scope:** `poc/typespec-as-schema` — current v2 implementation.

---

## What This Does

Service teams write `.tsp` files to declare their resources and permissions. A TypeScript emitter (3 files, 709 lines) compiles them into four outputs: SpiceDB schema, per-service metadata, unified JSON Schema, and a bundled IR for Go consumers.

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
    │  RESOURCES        │       │  V1 PERMISSIONS   │
    │  (lib.ts)         │       │  (expand.ts)      │
    │                   │       │                   │
    │  Walk all models. │       │  Walk all models. │
    │  Find Assignable, │       │  Find V1Workspace │
    │  Permission,      │       │  Permission       │
    │  BoolRelation     │       │  instances.       │
    │  properties       │       │  Extract: app,    │
    │  → ResourceDef[]  │       │  resource, verb,  │
    │                   │       │  v2Perm           │
    └────────┬──────────┘       │  → V1Extension[]  │
             │                  └────────┬──────────┘
             └──────────┬────────────────┘
                        ▼
    ┌─────────────────────────────────────────────────────────┐
    │  STEP 3: EXPAND  (expand.ts — expandV1Permissions)      │
    │                                                         │
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
    │  Bool dedup: inventory_any_any added once even if       │
    │  both inv_host_view and inv_host_update request it.     │
    └───────────────────────┬─────────────────────────────────┘
                            │
                            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  STEP 4: GENERATE + EMIT  (lib.ts → spicedb-emitter.ts)│
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
    relation t_any_any_any: rbac/principal:*
    ...
}

definition rbac/role_binding {
    permission inventory_host_view = (subject & t_granted->inventory_host_view)
    ...
}

definition rbac/workspace {
    permission view_metadata = inventory_host_view + remediations_remediation_view
    permission inventory_host_view = t_binding->inventory_host_view + t_parent->inventory_host_view
    ...
}

definition inventory/host {
    permission view = t_workspace->inventory_host_view
    permission update = t_workspace->inventory_host_update
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
  "version": "1.1.0",
  "resources": [ /* expanded ResourceDef[] */ ],
  "extensions": [ /* V1Extension[] */ ],
  "spicedb": "definition rbac/principal { ... }",
  "metadata": { /* per-service */ },
  "jsonSchemas": { /* unified JSON Schema fragments */ }
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
| `src/lib.ts` | 421 | Types (`ResourceDef`, `RelationBody`, `V1Extension`), resource discovery, permission expression parser, all 4 generators |
| `src/expand.ts` | 217 | V1 permission discovery, explicit expansion (7 mutations per extension) |
| `src/spicedb-emitter.ts` | 71 | CLI entry point: compile → discover → expand → generate → emit |
| **Total** | **709** | |

### Commands

```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp                 # SpiceDB output
npx tsx src/spicedb-emitter.ts schema/main.tsp --metadata      # Service metadata
npx tsx src/spicedb-emitter.ts schema/main.tsp --unified-jsonschema  # JSON Schema
npx tsx src/spicedb-emitter.ts schema/main.tsp --ir            # IR for Go consumer
npx vitest run                                                 # 96 tests
```

---

## Go Consumer Path

```
.tsp files → TypeSpec compile → emitter --ir → resources.json → go:embed → Go structs
```

Go runtime loads the pre-built IR. No Node.js dependency at runtime.
