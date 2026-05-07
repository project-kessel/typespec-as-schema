# Service Developer Walkthrough

How to work with the TypeSpec schema from a service team's perspective.

---

## Where Things Live

```
v2/typespec-as-schema/
├── lib/                          <- PLATFORM-OWNED (don't touch)
│   ├── kessel.tsp                   Core types: Assignable, Permission, BoolRelation, Cardinality
│   └── kessel-extensions.tsp        Platform extension templates: CascadeDeletePolicy, ResourceAnnotation
├── providers/                    <- SERVICE PROVIDERS
│   └── rbac/                        RBAC provider (owns extension logic)
│       ├── rbac.tsp                    Core RBAC types: Principal, Role, RoleBinding, Workspace
│       ├── rbac-extensions.tsp         RBAC extension template: V1WorkspacePermission
│       └── rbac-provider.ts            RBAC expansion logic (7 mutations, scaffold wiring)
├── schema/                       <- SERVICE AUTHORS WORK HERE
│   ├── main.tsp                     Entrypoint -- imports providers + services
│   ├── hbi.tsp                      HBI service (service team owns)
│   └── remediations.tsp             Remediations service (service team owns)
├── src/                          <- PLATFORM-OWNED (don't touch)
│   ├── provider.ts                  ExtensionProvider interface
│   ├── primitives.ts                Resource graph mutations (ref, subref, or, and, addRelation, cascade delete)
│   ├── discover-extensions.ts       Reusable template instance walking
│   ├── discover-platform.ts         Platform annotation + cascade discovery
│   ├── discover-resources.ts        Resource graph extraction from AST
└── go-loader-example/            <- PLATFORM-OWNED
    └── schema/                      Go structs + embedded IR
```

Service teams work in `schema/`. Extension providers (for example RBAC)
live under `providers/` and are maintained by the owning provider teams,
not by service teams. Everything in `lib/` and `src/` is platform code
that service teams never need to modify.

### What service authors use

These are the building blocks from `lib/kessel.tsp`, `lib/kessel-extensions.tsp`, and `providers/rbac/rbac-extensions.tsp` (for `V1WorkspacePermission`):

| TypeSpec construct | What it means | SpiceDB effect |
|---|---|---|
| `Assignable<Target, Cardinality>` | A relation that can be directly reported via API | `relation t_{name}: {target}` |
| `Permission<"expr">` | A computed permission derived from other relations | `permission {name} = {expr}` |
| `BoolRelation<Target>` | A boolean relation holding wildcards (`target:*`) | `relation t_{name}: {target}:*` |
| `V1WorkspacePermission<App, Res, Verb, V2>` (`providers/rbac/rbac-extensions.tsp`) | Maps a V1 app:resource:verb to a workspace permission | 7 mutations on Role, RoleBinding, Workspace |
| `CascadeDeletePolicy<ChildApp, ChildRes, ParentRel>` | Adds delete permission on child via parent relation | 1 mutation on child resource |
| `ResourceAnnotation<App, Res, Key, Val>` | Non-RBAC metadata (feature flags, retention, etc.) | None (IR metadata only) |

### Cardinality options

| Cardinality | Meaning | JSON Schema effect |
|---|---|---|
| `ExactlyOne` | Required, single value | `{name}_id` field, required |
| `AtMostOne` | Optional, single value | `{name}_id` field, optional |
| `AtLeastOne` | Required, one or more | Array, minItems: 1 |
| `Any` | Optional, zero or more | Array |
| `All` | Wildcard (e.g., `principal:*`) | N/A |

---

## Scenario 1: Adding a New Service

### The simplest case: permissions only

Some services (like Remediations) only need to register permissions on
workspaces. They don't define their own resource types.

**Create `schema/notifications.tsp`:**

```typespec
// Notifications Service Schema
// Registers workspace permissions without defining resource types.

import "../lib/kessel.tsp";
import "../providers/rbac/rbac-extensions.tsp";

using Kessel;

namespace Notifications;

// Each alias triggers 7 mutations on Role, RoleBinding, and Workspace.
// No TypeScript code needed.

/** Maps notifications:notifications:read -> notifications_notification_view */
alias viewPermission = Kessel.V1WorkspacePermission<
  "notifications",
  "notifications",
  "read",
  "notifications_notification_view"
>;

/** Maps notifications:notifications:write -> notifications_notification_update */
alias updatePermission = Kessel.V1WorkspacePermission<
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

The pipeline discovers the two `V1WorkspacePermission` aliases and
expands each into 7 mutations:

On **Role**:
- 4 bool relations for the hierarchy (`notifications_any_any`,
  `notifications_notifications_any`, `notifications_any_read`,
  `notifications_notifications_read`)
- 1 computed permission (`notifications_notification_view =
  any_any_any + notifications_any_any + ...`)

On **RoleBinding**:
- 1 intersection permission (`notifications_notification_view =
  subject & t_granted->notifications_notification_view`)

On **Workspace**:
- 1 union permission (`notifications_notification_view =
  t_binding->notifications_notification_view +
  t_parent->notifications_notification_view`)
- `view_metadata` automatically accumulates `notifications_notification_view`
  because its verb is `"read"`

Same pattern repeats for `_update` with `"write"` verb bools.

**Service author effort: 1 file, ~25 lines, zero TypeScript.**

---

### A service with resource types

If your service owns a resource (like HBI owns hosts), you define a
model in addition to the permission aliases.

**Create `schema/content-sources.tsp`:**

```typespec
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "../providers/rbac/rbac-extensions.tsp";
import "../providers/rbac/rbac.tsp";

using Kessel;

namespace ContentSources;

// ── Workspace permissions ────────────────────────────────────────────

alias templateView = Kessel.V1WorkspacePermission<
  "content_sources", "templates", "read", "content_sources_template_view"
>;
alias templateEdit = Kessel.V1WorkspacePermission<
  "content_sources", "templates", "write", "content_sources_template_edit"
>;

// ── Resource type (relations + data + permissions together) ─────────

model Template {
  /** Every template belongs to exactly one workspace */
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;

  /** Data fields are declared inline and flow into unified JSON schema */
  @maxLength(255) name?: string;
  @maxLength(1024) description?: string;
  @format("uri") repository_url?: string;

  /** View permission: resolves via workspace */
  view: Permission<"workspace.content_sources_template_view">;

  /** Edit permission: resolves via workspace */
  edit: Permission<"workspace.content_sources_template_edit">;
}

// ── Metadata annotations (IR only, not in SpiceDB) ──────────────────

alias templateRetention = Kessel.ResourceAnnotation<
  "content_sources", "template", "retention_days", "365"
>;
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

    relation t_workspace: rbac/workspace
}
```

JSON Schema: `content_sources/template` with required `workspace_id`
(uuid format) plus the inline data fields above, because `workspace` has
cardinality `ExactlyOne` and the pipeline emits the non-Kessel fields from
the same flat model.

Metadata (`--metadata`):
```json
{
  "content_sources": {
    "permissions": ["content_sources_template_view", "content_sources_template_edit"],
    "resources": ["template"],
    "annotations": {
      "content_sources/template:retention_days": "365"
    }
  }
}
```

Annotations (`--annotations`):
```json
{
  "content_sources/template": {
    "retention_days": "365"
  }
}
```

**Service author effort: 1 file, ~45 lines, zero TypeScript.**

---

## Scenario 2: Adding New Types to an Existing Service

Adding a new resource type to a service that already exists.

### Example: adding a Group resource to HBI

Groups contain hosts and need their own permissions.

**Edit `schema/hbi.tsp` -- add after the existing Host model:**

```typespec
// ── Group permissions ────────────────────────────────────────────────

alias groupViewPermission = Kessel.V1WorkspacePermission<
  "inventory", "groups", "read", "inventory_group_view"
>;
alias groupUpdatePermission = Kessel.V1WorkspacePermission<
  "inventory", "groups", "write", "inventory_group_update"
>;

// ── Group resource type ──────────────────────────────────────────────

model Group {
  /** Every group belongs to exactly one workspace */
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;

  /** A group contains zero or more hosts */
  hosts: Assignable<Host, Cardinality.Any>;

  /** Data fields */
  @maxLength(255) display_name?: string;
  @maxLength(1024) description?: string;

  /** View permission */
  view: Permission<"workspace.inventory_group_view">;

  /** Update permission */
  update: Permission<"workspace.inventory_group_update">;
}
```

No changes to `main.tsp` -- it already imports `hbi.tsp`.

**What gets generated for the new type:**

SpiceDB:
```
definition inventory/group {
    permission workspace = t_workspace
    permission hosts = t_hosts
    permission view = t_workspace->inventory_group_view
    permission update = t_workspace->inventory_group_update

    relation t_workspace: rbac/workspace
    relation t_hosts: inventory/host
}
```

The `hosts` relation uses `Cardinality.Any`, so it creates a SpiceDB
relation (tuples can be written) but no JSON Schema field (no `_id`
field is generated for `Any` cardinality -- only `ExactlyOne` produces
a required `_id` field).

Metadata updates `inventory` to include `"group"` in resources and both
new permissions in the permissions list.

**Service author effort: ~25 lines added to existing file, zero TypeScript.**

---

### Example: adding data fields to an existing resource

If a resource already exists and you need to add validation fields:

**Edit the existing `Host` model in `schema/hbi.tsp`:**

```typespec
@format("uuid")
scalar UuidString extends string;

model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  @format("uuid") subscription_manager_id?: string;
  satellite_id?: UuidString | SatelliteNumericId;
  @format("uuid") insights_id?: string;
  @maxLength(255) ansible_host?: string;

  // New fields:
  @maxLength(255) display_name?: string;      // <- add
  @format("date-time") last_seen?: string;    // <- add

  view: Permission<"workspace.inventory_host_view">;
  update: Permission<"workspace.inventory_host_update">;
}
```

The `?` suffix makes a field optional. Without it, the field would be
required in the unified JSON Schema. These data fields are emitted by the
CLI pipeline from the flat resource model and do not affect SpiceDB output.

---

## Scenario 3: Adding New Kinds of Extensions

> **Note:** The extensions described below (`ContingentPermission`, `ExposeHostPermission`) are **not yet implemented** — this section shows the pattern for adding them.

This section uses the real production KSL from
[rbac-config](https://github.com/RedHatInsights/rbac-config/blob/master/configs/prod/schemas/src/)
to show how new extension types work.

### Background: the production extension landscape

The production `rbac-config` repository has four extension types:

| KSL extension | Purpose | Used by |
|---|---|---|
| `add_v1_based_permission` | Maps V1 app:resource:verb to workspace permission | All services |
| `add_contingent_permission` | Intersects two existing workspace perms | advisor, patch, vulnerability, malware, ros |
| `expose_host_permission` | Passes workspace perm through to host | advisor, patch, ros |
| `add_unified_permission` | V1/V2 share same name | rbac (internal) |

Our POC currently implements the first one (`V1WorkspacePermission`, RBAC provider-owned).
Here is how to add the other two that matter for service teams.

### How extensions work: the trust boundary

Every extension spans a trust boundary across three layers:

```
  SERVICE AUTHORS          PROVIDER TEAMS              PLATFORM TEAM
  (schema/)                (providers/rbac/)           (lib/ + src/)
  ─────────────            ───────────────             ─────────────────
  Write alias              RBAC example:             Core types in lib/;
  declarations:            V1WorkspacePermission      primitives, pipeline,
  alias foo =              template in                discover-extensions/
    Kessel.Template<       rbac-extensions.tsp;      platform/resources;
    "p1", "p2"             expansion + wiring in      non-RBAC templates in
  >;                       rbac-provider.ts           kessel-extensions.tsp

  Zero computation.        Provider-owned logic       Platform-owned
  Only type aliases.       for that domain.           infrastructure.
```

Adding a new **platform-neutral** extension template still means platform
changes (template in `lib/kessel-extensions.tsp`, registry, discovery,
expansion, pipeline). Adding a **provider-owned** extension (like
`V1WorkspacePermission`) is done by the provider team under `providers/`.
Service authors then consume extensions by writing aliases only -- no
TypeScript, no logic.

---

### Extension: `ContingentPermission`

#### What it does

Creates a workspace permission that is the **intersection** of two
existing permissions. From the production KSL:

```ksl
extension add_contingent_permission(first, second, contingent) {
    type platform  { relation `${contingent}`: `${first}` and `${second}` }
    type tenant    { relation `${contingent}`: `${first}` and `${second}` }
    type workspace { relation `${contingent}`: `${first}` and `${second}` }
}
```

"You need **both** `first` AND `second` to have `contingent`."

#### Why it exists

Services like advisor and patch have host-scoped data. Their permissions
require two conditions: (1) the user has the service-specific permission
AND (2) the user can view hosts in HBI. The `_assigned` permission
covers condition 1. The contingent permission intersects it with
`inventory_host_view` to enforce both conditions at the workspace level.

#### Platform implementation

**`lib/kessel-extensions.tsp`** -- add the template:

```typespec
/**
 * Creates a workspace permission requiring BOTH of two existing permissions.
 * Produces: workspace.{contingent} = {first} AND {second}
 *
 * Example: advisor_results_view = inventory_host_view AND advisor_results_view_assigned
 */
model ContingentPermission<
  First extends string,
  Second extends string,
  Contingent extends string
> {
  first: First;
  second: Second;
  contingent: Contingent;
}
```

**`src/registry.ts`** -- add to `PLATFORM_TEMPLATES`:

```typescript
export const PLATFORM_TEMPLATES: readonly ExtensionTemplateDef[] = [
  { templateName: "ResourceAnnotation",    paramNames: ["application", "resource", "key", "value"], namespace: "Kessel" },
  { templateName: "CascadeDeletePolicy",   paramNames: ["childApplication", "childResource", "parentRelation"], namespace: "Kessel" },
  { templateName: "ContingentPermission",  paramNames: ["first", "second", "contingent"], namespace: "Kessel" },  // <- add
];
```

The pipeline calls `buildRegistry(providers)` to combine `PLATFORM_TEMPLATES` with provider-contributed templates, so the new template is automatically included in discovery.

**`src/discover-platform.ts`** -- add a discovery function:

```typescript
export interface ContingentExtension {
  first: string;
  second: string;
  contingent: string;
}

export function discoverContingentPermissions(
  program: Program,
  warnings?: DiscoveryWarnings,
): ContingentExtension[] {
  const def = getTemplate("ContingentPermission");
  const { results, skipped } = discoverExtensionInstances(program, def);
  if (warnings) warnings.skipped.push(...skipped);
  return results.filter(
    (p): p is Record<string, string> & ContingentExtension =>
      !!(p.first && p.second && p.contingent),
  );
}
```

**`src/primitives.ts`** -- add pure expansion logic (no TypeSpec imports):

```typescript
export function expandContingentPermissions(
  resources: ResourceDef[],
  extensions: ContingentExtension[],
): ResourceDef[] {
  const result = cloneResources(resources);
  const workspace = findResource(result, "rbac", "workspace");
  if (!workspace) return result;

  for (const ext of extensions) {
    addRelation(workspace, {
      name: ext.contingent,
      body: and(ref(ext.first), ref(ext.second)),
    });
  }

  return result;
}
```

**`src/pipeline.ts`** -- wire into the pipeline:

```typescript
// After V1 expansion:
const contingentPerms = discoverContingentPermissions(program, discoveryWarnings);
const contingentResult = expandContingentPermissions(expanded, contingentPerms);
```

#### What service authors write

```typespec
alias resultsViewContingent = Kessel.ContingentPermission<
  "inventory_host_view",
  "advisor_recommendation_results_view_assigned",
  "advisor_recommendation_results_view"
>;
```

One alias line. Zero computation.

**SpiceDB output on workspace:**
```
permission advisor_recommendation_results_view = (inventory_host_view & advisor_recommendation_results_view_assigned)
```

---

### Extension: `ExposeHostPermission`

#### What it does

Passes a workspace-level permission through to `hbi/host`, gated by
host view access. From the production KSL
([hbi.ksl#L22](https://github.com/RedHatInsights/rbac-config/blob/master/configs/prod/schemas/src/hbi.ksl#L22)):

```ksl
public extension expose_host_permission(v2_perm, host_perm) {
    type host {
        public relation `${host_perm}`: view and workspace.`${v2_perm}`
    }
}
```

"Add a permission to `hbi/host` that requires **both** being able to
view the host (`view`) **AND** having the workspace-level permission
(`workspace.{v2_perm}`)."

#### Why it exists

Services like advisor, patch, and ros have data that lives per-host.
When checking permissions, you need to verify the user can see that
*specific* host, not just any host in the workspace. This extension
exposes the workspace permission on the host itself, intersected with
host view access.

#### How it's used in production

The production KSL uses a 3-step pattern. Here is the advisor example
([advisor.ksl](https://github.com/RedHatInsights/rbac-config/blob/master/configs/prod/schemas/src/advisor.ksl)):

```ksl
// Step 1: Create the "_assigned" permission on workspace (V1 mapping)
@rbac.add_v1_based_permission(
  app:'advisor', resource:'recommendation_results', verb:'read',
  v2_perm:'advisor_recommendation_results_view_assigned'
);

// Step 2: Intersect with host visibility at the workspace level
@rbac.add_contingent_permission(
  first: 'inventory_host_view',
  second: 'advisor_recommendation_results_view_assigned',
  contingent: 'advisor_recommendation_results_view'
);

// Step 3: Pass through to the host
@hbi.expose_host_permission(
  v2_perm: 'advisor_recommendation_results_view',
  host_perm: 'advisor_recommendation_results_view'
);
```

The same 3-step pattern is used by
[patch.ksl](https://github.com/RedHatInsights/rbac-config/blob/master/configs/prod/schemas/src/patch.ksl)
and [ros.ksl](https://github.com/RedHatInsights/rbac-config/blob/master/configs/prod/schemas/src/ros.ksl).

#### Platform implementation

**`lib/kessel-extensions.tsp`** -- add the template:

```typespec
/**
 * Exposes a workspace permission through hbi/host.
 * The resulting permission requires BOTH host view access
 * AND the workspace permission.
 *
 * Produces: host.{hostPerm} = view AND workspace.{v2Perm}
 */
model ExposeHostPermission<
  V2Perm extends string,
  HostPerm extends string
> {
  v2Perm: V2Perm;
  hostPerm: HostPerm;
}
```

**`src/registry.ts`** -- add to `PLATFORM_TEMPLATES`:

```typescript
export const PLATFORM_TEMPLATES: readonly ExtensionTemplateDef[] = [
  // ... existing entries ...
  { templateName: "ContingentPermission",  paramNames: ["first", "second", "contingent"], namespace: "Kessel" },
  { templateName: "ExposeHostPermission",  paramNames: ["v2Perm", "hostPerm"], namespace: "Kessel" },  // <- add
];
```

**`src/discover-platform.ts`** -- add discovery:

```typescript
export interface ExposeHostExtension {
  v2Perm: string;
  hostPerm: string;
}

export function discoverExposeHostPermissions(
  program: Program,
  warnings?: DiscoveryWarnings,
): ExposeHostExtension[] {
  const def = getTemplate("ExposeHostPermission");
  const { results, skipped } = discoverExtensionInstances(program, def);
  if (warnings) warnings.skipped.push(...skipped);
  return results.filter(
    (p): p is Record<string, string> & ExposeHostExtension =>
      !!(p.v2Perm && p.hostPerm),
  );
}
```

**`src/primitives.ts`** -- add pure expansion:

```typescript
export function expandExposeHostPermissions(
  resources: ResourceDef[],
  extensions: ExposeHostExtension[],
): ResourceDef[] {
  const result = cloneResources(resources);
  const host = findResource(result, "inventory", "host");
  if (!host) return result;

  for (const ext of extensions) {
    addRelation(host, {
      name: ext.hostPerm,
      body: and(
        ref("view"),
        subref("workspace", ext.v2Perm),
      ),
    });
  }

  return result;
}
```

**`src/pipeline.ts`** -- wire into the pipeline:

```typescript
// After contingent expansion:
const exposeHostPerms = discoverExposeHostPermissions(program, discoveryWarnings);
const exposeResult = expandExposeHostPermissions(contingentResult, exposeHostPerms);
```

#### What service authors write

```typespec
alias exposeResultsView = Kessel.ExposeHostPermission<
  "advisor_recommendation_results_view",
  "advisor_recommendation_results_view"
>;
```

One alias line. Zero computation.

**SpiceDB output on host:**
```
permission advisor_recommendation_results_view = (view & t_workspace->advisor_recommendation_results_view)
```

---

### Full example: advisor.tsp (matching production KSL)

Here is what a complete advisor service file looks like, using all three
extension types. This matches the production
[advisor.ksl](https://github.com/RedHatInsights/rbac-config/blob/master/configs/prod/schemas/src/advisor.ksl):

```typespec
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "../providers/rbac/rbac-extensions.tsp";
import "../providers/rbac/rbac.tsp";
import "./hbi.tsp";

using Kessel;

namespace Advisor;

// ── Workspace-only permissions ───────────────────────────────────────

alias disableRecsView = Kessel.V1WorkspacePermission<
  "advisor", "disable_recommendations", "read",
  "advisor_disable_recommendations_view"
>;
alias disableRecsEdit = Kessel.V1WorkspacePermission<
  "advisor", "disable_recommendations", "write",
  "advisor_disable_recommendations_edit"
>;

alias weeklyEmailView = Kessel.V1WorkspacePermission<
  "advisor", "weekly_email", "read",
  "advisor_weekly_email_view"
>;

alias weeklyReportView = Kessel.V1WorkspacePermission<
  "advisor", "weekly_report", "read",
  "advisor_weekly_report_view"
>;

alias weeklyAutoSubView = Kessel.V1WorkspacePermission<
  "advisor", "weekly_report_auto_subscribe", "read",
  "advisor_weekly_report_auto_subscribe_view"
>;
alias weeklyAutoSubEdit = Kessel.V1WorkspacePermission<
  "advisor", "weekly_report_auto_subscribe", "write",
  "advisor_weekly_report_auto_subscribe_edit"
>;

alias exportsView = Kessel.V1WorkspacePermission<
  "advisor", "exports", "read",
  "advisor_exports_view"
>;

// ── Host-contingent permission: recommendation results (view) ────────
// 3-step pattern: V1 mapping -> contingent intersection -> expose on host

alias resultsViewAssigned = Kessel.V1WorkspacePermission<
  "advisor", "recommendation_results", "read",
  "advisor_recommendation_results_view_assigned"
>;

alias resultsViewContingent = Kessel.ContingentPermission<
  "inventory_host_view",
  "advisor_recommendation_results_view_assigned",
  "advisor_recommendation_results_view"
>;

alias exposeResultsView = Kessel.ExposeHostPermission<
  "advisor_recommendation_results_view",
  "advisor_recommendation_results_view"
>;

// ── Host-contingent permission: recommendation results (edit) ────────

alias resultsEditAssigned = Kessel.V1WorkspacePermission<
  "advisor", "recommendation_results", "write",
  "advisor_recommendation_results_edit_assigned"
>;

alias resultsEditContingent = Kessel.ContingentPermission<
  "inventory_host_view",
  "advisor_recommendation_results_edit_assigned",
  "advisor_recommendation_results_edit"
>;

alias exposeResultsEdit = Kessel.ExposeHostPermission<
  "advisor_recommendation_results_edit",
  "advisor_recommendation_results_edit"
>;
```

**What this produces in SpiceDB:**

```
// On rbac/role:
permission advisor_recommendation_results_view_assigned = any_any_any + advisor_any_any + ...
permission advisor_recommendation_results_edit_assigned = any_any_any + advisor_any_any + ...

// On rbac/role_binding:
permission advisor_recommendation_results_view_assigned = (subject & t_granted->...)
permission advisor_recommendation_results_edit_assigned = (subject & t_granted->...)

// On rbac/workspace:
permission advisor_recommendation_results_view_assigned = t_binding->... + t_parent->...
permission advisor_recommendation_results_edit_assigned = t_binding->... + t_parent->...
permission advisor_recommendation_results_view = (inventory_host_view & advisor_recommendation_results_view_assigned)
permission advisor_recommendation_results_edit = (inventory_host_view & advisor_recommendation_results_edit_assigned)

// On inventory/host:
permission advisor_recommendation_results_view = (view & t_workspace->advisor_recommendation_results_view)
permission advisor_recommendation_results_edit = (view & t_workspace->advisor_recommendation_results_edit)
```

---

## Pipeline Ordering

Extensions must run in order because later ones reference permissions
created by earlier ones:

```
1. V1WorkspacePermission (RBAC provider) -> creates _assigned perms on workspace
2. ContingentPermission       -> intersects workspace perms (needs step 1)
3. ExposeHostPermission       -> references workspace perms on host (needs step 2)
4. view_metadata accumulation -> ORs all read-verb perms (after all workspace perms exist)
```

This ordering is explicit in `src/pipeline.ts` (called by `spicedb-emitter.ts`).
No implicit dependency resolution is needed.

---

## Extension Complexity Budget

| Extension type | Template params | Mutations per use | Complexity |
|---|---|---|---|
| `V1WorkspacePermission` | 4 | 7 (4 role bools + role perm + rb perm + ws perm) | O(N) |
| `CascadeDeletePolicy` | 3 | 1 (child resource delete permission) | O(N) |
| `ContingentPermission` | 3 | 1 (workspace intersection) | O(N) |
| `ExposeHostPermission` | 2 | 1 (host intersection) | O(N) |
| `ResourceAnnotation` | 4 | 0 (metadata only, no SpiceDB effect) | O(N) |

For any combination of extensions, total work is bounded and linear.
Service authors never write computation -- only type alias declarations.

---

## Summary: What Each Role Does

| Task | Who | Files touched | Lines | TypeScript? |
|---|---|---|---|---|
| New permissions-only service | Service team | 1 new `.tsp` + 1 import in `main.tsp` | ~25 | No |
| New resource type | Service team | Edit existing `.tsp` | ~20-30 | No |
| New data fields on existing type | Service team | Edit `*Data` model | ~5 | No |
| Attach metadata annotation | Service team | 1 alias line | ~5 | No |
| Use existing extension template | Service team | 1 alias line | ~5 | No |
| **New extension template** | Platform or provider team | Template + discovery (discover-platform.ts) + expansion (primitives.ts) or provider package (`providers/…`) | ~50 | Yes |

The last row is the only case requiring TypeScript, and that work is
done by the platform or owning provider team -- not service teams. The structural safety
guarantee holds: service authors write zero computation regardless of
how many extension types exist.
