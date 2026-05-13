# Service Developer Walkthrough

How to work with the TypeSpec schema from a service team's perspective.

---

## Where Things Live

```
typespec-as-schema/
├── lib/                            <- PLATFORM-OWNED (don't touch)
│   ├── kessel.tsp                     Core types: Assignable, Permission, BoolRelation, Cardinality
│   ├── kessel-decorators.tsp          Decorator declarations: @provider, @annotation, @cascadeDelete
│   └── kessel-extensions.tsp          Platform extension namespace
├── schema/                         <- SERVICE AUTHORS WORK HERE
│   ├── main.tsp                       Entrypoint — imports all service schemas
│   ├── hbi.tsp                        HBI service (inventory team owns)
│   ├── remediations.tsp               Remediations service
│   ├── rbac/                          RBAC provider (owns extension logic)
│   │   ├── rbac.tsp                      Core types: Principal, Role, RoleBinding, Workspace
│   │   ├── rbac-extensions.tsp           Extension template: V1WorkspacePermission
│   │   └── rbac-provider.ts              RBAC expansion logic (7 mutations per permission)
│   └── hbi/                           HBI provider (owns host-level extensions)
│       ├── hbi-extensions.tsp            Extension template: ExposeHostPermission
│       └── hbi-provider.ts               HBI expansion logic
├── src/                            <- PLATFORM-OWNED (don't touch)
│   ├── provider.ts                    ExtensionProvider interface
│   ├── define-provider.ts             defineProvider() helper
│   ├── primitives.ts                  Graph mutation helpers (ref, subref, or, and, ...)
│   ├── decorator-reader.ts            Reads @provider, @annotation, @cascadeDelete from AST
│   ├── discover-extensions.ts         Template instance discovery
│   ├── discover-resources.ts          Resource graph extraction
│   └── pipeline.ts                    Full compilation pipeline
└── go-loader-example/              <- PLATFORM-OWNED
    └── schema/                        Go structs + embedded IR
```

Service teams work in `schema/`. Extension providers (RBAC, HBI) are maintained
by the owning provider teams. Everything in `lib/` and `src/` is platform code.

---

## Building Blocks

These types from `lib/kessel.tsp` are hat service authors use to defwine resources:

| TypeSpec construct | What it means | SpiceDB effect |
|---|---|---|
| `Assignable<Target, Cardinality>` | A relation that can be directly written via API | `relation t_{name}: {target}` |
| `Permission<"expr">` | A computed permission derived from other relations | `permission {name} = {expr}` |
| `BoolRelation<Target>` | A boolean relation holding wildcards (`target:*`) | `relation t_{name}: {target}:*` |

### Cardinality options

| Cardinality | Meaning | JSON Schema effect |
|---|---|---|
| `ExactlyOne` | Required, single value | `{name}_id` field, required |
| `AtMostOne` | Optional, single value | `{name}_id` field, optional |
| `AtLeastOne` | Required, one or more | Array, minItems: 1 |
| `Any` | Optional, zero or more | Array |
| `All` | Wildcard (e.g., `principal:*`) | N/A |

### Decorators

These decorators are applied directly to resource models:

| Decorator | Purpose | Effect |
|---|---|---|
| `@annotation(key, value)` | Attach metadata to a resource (feature flags, retention, etc.) | IR metadata only — no SpiceDB change |
| `@cascadeDelete(parentRelation)` | Wire cascade-delete authorization through a parent relation | Adds `delete` permission on the resource |

You can stack multiple `@annotation` decorators on the same model.

### Extension templates

These are owned by provider teams. Service authors consume them via aliases:

| Template | Provider | Purpose |
|---|---|---|
| `RBAC.V1WorkspacePermission<App, Res, Verb, V2>` | RBAC | Maps a V1 app:resource:verb to a workspace permission (7 mutations) |
| `HBI.ExposeHostPermission<V2Perm, HostPerm>` | HBI | Passes a workspace permission through to `inventory/host` |

---

## Scenario 1: Adding a New Service

### Permissions-only service

Some services (like Remediations) only need workspace permissions. They don't
define their own resource types.

**Create `schema/notifications.tsp`:**

```typespec
import "../lib/kessel.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;

namespace Notifications;

alias viewPermission = RBAC.V1WorkspacePermission<
  "notifications",
  "notifications",
  "read",
  "notifications_notification_view"
>;

alias updatePermission = RBAC.V1WorkspacePermission<
  "notifications",
  "notifications",
  "write",
  "notifications_notification_update"
>;
```

**Add one import to `schema/main.tsp`:**

```typespec
import "./notifications.tsp";
```

**Run:**

```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp              # SpiceDB schema
npx tsx src/spicedb-emitter.ts schema/main.tsp --metadata    # service metadata
make demo                                                    # all outputs at once
```

**What happens automatically:**

The pipeline discovers the `V1WorkspacePermission` aliases and expands each
into 7 mutations:

On **Role**:
- 4 bool relations for the hierarchy (`notifications_any_any`,
  `notifications_notifications_any`, `notifications_any_read`,
  `notifications_notifications_read`)
- 1 computed permission (`notifications_notification_view =
  any_any_any + notifications_any_any + ...`)

On **RoleBinding**:
- 1 intersection permission (`notifications_notification_view =
  subject & granted->notifications_notification_view`)

On **Workspace**:
- 1 union permission (`notifications_notification_view =
  binding->notifications_notification_view +
  parent->notifications_notification_view`)
- `view_metadata` automatically accumulates `notifications_notification_view`
  because its verb is `"read"`

**Service author effort: 1 file, ~20 lines, zero TypeScript.**

---

### A service with resource types

If your service owns a resource (like HBI owns hosts), you define a model with
relations, data fields, and permissions. Decorators replace what used to be
separate alias-based annotations and cascade-delete policies.

**Create `schema/content-sources.tsp`:**

```typespec
import "../lib/kessel.tsp";
import "./rbac/rbac-extensions.tsp";
import "./rbac/rbac.tsp";

using Kessel;

namespace ContentSources;

alias templateView = RBAC.V1WorkspacePermission<
  "content_sources", "templates", "read", "content_sources_template_view"
>;
alias templateEdit = RBAC.V1WorkspacePermission<
  "content_sources", "templates", "write", "content_sources_template_edit"
>;

@annotation("retention_days", "365")
@cascadeDelete("workspace")
model Template {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;

  @maxLength(255) name?: string;
  @maxLength(1024) description?: string;
  @format("uri") repository_url?: string;

  view: Permission<"workspace.content_sources_template_view">;
  edit: Permission<"workspace.content_sources_template_edit">;
}
```

**Add to `schema/main.tsp`:**

```typespec
import "./content-sources.tsp";
```

**What gets generated:**

SpiceDB:
```
definition content_sources/template {
    permission workspace = t_workspace
    permission view = t_workspace->content_sources_template_view
    permission edit = t_workspace->content_sources_template_edit
    permission delete = t_workspace->delete

    relation t_workspace: rbac/workspace
}
```

The `@cascadeDelete("workspace")` adds the `delete` permission via the
workspace relation. The `@annotation("retention_days", "365")` appears in
the IR metadata output but does not affect SpiceDB.

**Service author effort: 1 file, ~30 lines, zero TypeScript.**

---

## Scenario 2: Adding New Types to an Existing Service

### Example: adding a Group resource to HBI

**Edit `schema/hbi.tsp` — add after the existing Host model:**

```typespec
alias groupViewPermission = RBAC.V1WorkspacePermission<
  "inventory", "groups", "read", "inventory_group_view"
>;
alias groupUpdatePermission = RBAC.V1WorkspacePermission<
  "inventory", "groups", "write", "inventory_group_update"
>;

@cascadeDelete("workspace")
model Group {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  hosts: Assignable<Host, Cardinality.Any>;

  @maxLength(255) display_name?: string;

  view: Permission<"workspace.inventory_group_view">;
  update: Permission<"workspace.inventory_group_update">;
}
```

No changes to `main.tsp` — it already imports `hbi.tsp`.

**Service author effort: ~20 lines added to existing file, zero TypeScript.**

### Adding data fields to an existing resource

Edit the model directly:

```typespec
model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  // ... existing fields ...

  @maxLength(255) display_name?: string;       // <- add
  @format("date-time") last_seen?: string;     // <- add

  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;
}
```

The `?` suffix makes a field optional. These data fields flow into unified JSON
Schema output. They do not affect SpiceDB.

---

## Scenario 3: Cross-Provider Extensions

Some services need permissions that span multiple providers. For example, a
service that has host-scoped data needs both RBAC workspace permissions (via
the RBAC provider) and host-level permission exposure (via the HBI provider).

### The pattern

```
1. RBAC.V1WorkspacePermission         -> creates workspace-level permission
2. HBI.ExposeHostPermission            -> passes it through to host
```

The service author writes one alias per step. The pipeline runs providers in
order, so later steps can reference permissions created by earlier ones.

### Example: ROS service needing host-level permissions

**Create `schema/ros.tsp`:**

```typespec
import "../lib/kessel.tsp";
import "./rbac/rbac-extensions.tsp";
import "./hbi/hbi-extensions.tsp";

using Kessel;

namespace ROS;

// Step 1: Wire ros_read_analysis onto workspace via RBAC
alias rosAnalysisPermission = RBAC.V1WorkspacePermission<
  "ros",
  "analysis",
  "read",
  "ros_read_analysis"
>;

// Step 2: Expose ros_read_analysis through to host via HBI
alias rosHostAnalysis = HBI.ExposeHostPermission<
  "ros_read_analysis",
  "ros_read_analysis"
>;
```

**What gets generated:**

On **rbac/workspace** (from step 1):
```
permission ros_read_analysis = t_binding->ros_read_analysis + t_parent->ros_read_analysis
```

On **inventory/host** (from step 2):
```
permission ros_read_analysis = (view & t_workspace->ros_read_analysis)
```

The host permission requires **both** being able to view the host (`view`)
**and** having the workspace-level permission (`workspace.ros_read_analysis`).

**Service author effort: 1 file, ~20 lines, zero TypeScript.**

---

## Decorator Reference

### `@annotation(key, value)`

Attaches metadata to a resource. Does not affect SpiceDB — annotations appear
only in the IR metadata output.

```typespec
@annotation("feature_flag", "staleness_v2")
@annotation("retention_days", "90")
model Host {
  // ...
}
```

Multiple `@annotation` decorators can be stacked on the same model.

### `@cascadeDelete(parentRelation)`

Adds a `delete` permission gated on the parent's delete permission. When the
parent is deleted, authorization cascades to the child.

```typespec
@cascadeDelete("workspace")
model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  // ...
}
```

The `parentRelation` must match the name of an `Assignable` property on the
model (in this case, `"workspace"` matches the `workspace` property).

---

## Real-World Example: HBI Host (complete)

This is the actual `schema/hbi.tsp` in the codebase, showing all features
together:

```typespec
import "../lib/kessel.tsp";
import "./rbac/rbac-extensions.tsp";
import "./rbac/rbac.tsp";

using Kessel;

namespace Inventory;

// Extension aliases — wire workspace permissions via RBAC
alias viewPermission = RBAC.V1WorkspacePermission<
  "inventory", "hosts", "read", "inventory_host_view"
>;
alias updatePermission = RBAC.V1WorkspacePermission<
  "inventory", "hosts", "write", "inventory_host_update"
>;

@format("uuid")
scalar UuidString extends string;

@pattern("^\\d{10}$")
scalar SatelliteNumericId extends string;

// Decorators on the model itself
@annotation("feature_flag", "staleness_v2")
@annotation("retention_days", "90")
@cascadeDelete("workspace")
model Host {
  // Relation: belongs to a workspace
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;

  // Data fields: flow into JSON Schema, not SpiceDB
  @format("uuid") subscription_manager_id?: string;
  satellite_id?: UuidString | SatelliteNumericId;
  @format("uuid") insights_id?: string;
  @maxLength(255) ansible_host?: string;

  // Computed permissions: reference workspace-level perms from RBAC
  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;
}
```

---

## Summary: What Each Role Does

| Task | Who | Files touched | TypeScript? |
|---|---|---|---|
| New permissions-only service | Service team | 1 new `.tsp` + 1 import in `main.tsp` | No |
| New resource type | Service team | Edit existing `.tsp` | No |
| New data fields | Service team | Edit model in `.tsp` | No |
| Attach metadata | Service team | Add `@annotation` to model | No |
| Add cascade-delete | Service team | Add `@cascadeDelete` to model | No |
| Use cross-provider extension | Service team | Add alias line | No |
| **New extension template** | Provider team | Template `.tsp` + provider `.ts` | Yes |
