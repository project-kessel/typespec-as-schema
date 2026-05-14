# Service Provider Integration Guide

How service teams integrate with `typespec-as-schema` to register workspace permissions, declare resource types, and ship SpiceDB-shaped authorization together with optional metadata and JSON Schema hints.

---

## 1. Architecture overview

The package is a **registered TypeSpec emitter**. The compiler loads it as a library; when you run `tsp compile`, TypeSpec invokes **`$onEmit`** in `src/emitter.ts`. That function orchestrates discovery, RBAC expansion, validation, and file emission—there is no separate IR pipeline or consumer-specific CLI in this repo.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Service .tsp files          RBAC TypeSpec (templates + core graph)       │
│  ─────────────────           ─────────────────────────────────────        │
│  schema/<service>.tsp        schema/rbac/rbac.tsp                         │
│                              schema/rbac/rbac-extensions.tsp              │
│                                                                            │
│  Shared DSL + decorators     Emitter plugin (TypeScript)                   │
│  ─────────────────────       ──────────────────────────                  │
│  lib/kessel.tsp              src/emitter.ts          ← $onEmit            │
│  lib/kessel-extensions.tsp   src/providers/rbac/rbac-provider.ts          │
│  lib/decorators.tsp              (expandV1Permissions, discoverV1…)       │
│                                 src/discover-decorated.ts                   │
│                                 src/discover-resources.ts                 │
│                                 src/safety.ts (expression checks)           │
│                                 src/generate.ts (SpiceDB, metadata, JSON)   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Two discovery paths:**

| What | How |
|------|-----|
| **V1 workspace permissions** (`V1WorkspacePermission<...>`) | **Template / alias walking** via `discoverV1Permissions()` in `rbac-provider.ts`. Finds template instances and **resolved alias** declarations. Does **not** rely on `@kesselExtension`. |
| **Cascade delete policies** and **resource annotations** | **Decorator state sets**: `@cascadePolicy` and `@annotation` add models to compiler state; `discoverDecoratedCascadePolicies()` and `discoverDecoratedAnnotations()` read that state. |

The **`@kesselExtension`** decorator is implemented (it registers models in a state set) but **is not required** for RBAC V1 permission discovery. Prefer **`alias ... = Kessel.V1WorkspacePermission<...>`** (or an equivalent template instance) so permissions are picked up the same way as in this repo’s `schema/remediations.tsp` and `schema/hbi.tsp`.

**Emit-time data flow (simplified):**

1. `discoverResources(program)` → resource graph before RBAC/cascade mutations.
2. `discoverV1Permissions(program)` → list of V1 extensions.
3. `discoverDecoratedCascadePolicies` / `discoverDecoratedAnnotations` → platform extras.
4. `validatePreExpansionExpressions(resources)` → local relation references.
5. `expandV1Permissions` + `wireDeleteScaffold` + `expandCascadeDeletePolicies` → full graph used for SpiceDB and unified JSON Schema.
6. `validatePermissionExpressions(fullSchema)` → post-expansion expression checks (errors only if `--option typespec-as-schema.strict=true`).
7. Emit **one** artifact according to `typespec-as-schema.output-format`.

**Metadata note:** `generateMetadata()` is called with the **pre-expansion** `resources` array (plus permissions, annotations, cascade entries), not the post-expansion `fullSchema`. That keeps per-service resource listings aligned with authored models rather than the RBAC-expanded graph.

---

## 2. Quick start: permissions-only service

Register permissions without defining your own resource types. Use **aliases** to `Kessel.V1WorkspacePermission<...>`.

**Create `schema/notifications.tsp`:**

```typespec
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "./rbac/rbac-extensions.tsp";
import "./rbac/rbac.tsp";

using Kessel;

namespace Notifications;

alias notificationView = Kessel.V1WorkspacePermission<
  "notifications",
  "notifications",
  "read",
  "notifications_notification_view"
>;

alias notificationUpdate = Kessel.V1WorkspacePermission<
  "notifications",
  "notifications",
  "write",
  "notifications_notification_update"
>;
```

**Import it from `schema/main.tsp`:**

```typespec
import "./notifications.tsp";
```

**Compile:**

```bash
npm run build
tsp compile schema/main.tsp --option typespec-as-schema.output-format=spicedb
```

Default output format is `spicedb` if you omit the option (`schema.zed` under the emitter output dir).

**What expansion does:** For each discovered permission, the RBAC provider applies the usual mutations (wildcard relations on `rbac/role`, computed permission on role, binding intersection, workspace union). If the verb is `"read"`, the permission is also folded into `workspace.view_metadata`.

**Rough effort:** one small `.tsp` file and a single import in `main.tsp`.

---

## 3. Quick start: full resource type

When you own definitions in SpiceDB (e.g. `inventory/host`), declare models with `Assignable`, `Permission<SubRef<...>>`, optional `@jsonSchema` data models, and—when needed—`@cascadePolicy` / `@annotation`.

**Pattern (trimmed from `schema/hbi.tsp`):**

```typespec
import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "../lib/decorators.tsp";
import "./rbac/rbac-extensions.tsp";
import "./rbac/rbac.tsp";

using JsonSchema;
using Kessel;

namespace Inventory;

alias viewPermission = Kessel.V1WorkspacePermission<
  "inventory",
  "hosts",
  "read",
  "inventory_host_view"
>;

alias updatePermission = Kessel.V1WorkspacePermission<
  "inventory",
  "hosts",
  "write",
  "inventory_host_update"
>;

@cascadePolicy
model hostCascadeDelete is CascadeDeletePolicy<"inventory", "host", "workspace">;

@annotation
model hostRetention is ResourceAnnotation<"inventory", "host", "retention_days", "90">;

@jsonSchema
model HostData {
  @format("uuid") subscription_manager_id?: string;
  @maxLength(255) ansible_host?: string;
}

model Host {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  data: HostData;
  view: Permission<SubRef<"workspace", "inventory_host_view">>;
  update: Permission<SubRef<"workspace", "inventory_host_update">>;
}
```

After compile, SpiceDB output includes your resource definition, workspace-linked permissions, and—when cascade expansion runs—`delete` wired through the parent relation per policy.

---

## 4. How decorators work

Declarations live in `lib/decorators.tsp`; implementations that push into compiler state are in `src/decorators.ts`.

### `@cascadePolicy`

Apply to a **`model ... is CascadeDeletePolicy<childApp, childResource, parentRelation>`**. Discovery: `discoverDecoratedCascadePolicies()` reads the `cascadePolicy` state set and extracts template arguments. Used during `expandCascadeDeletePolicies()` so the child’s `delete` permission references the parent’s `delete` through the named relation.

### `@annotation`

Apply to a **`model ... is ResourceAnnotation<application, resource, key, value>`**. Discovery: `discoverDecoratedAnnotations()` reads the `annotation` state set. Values surface in **`metadata.json`** (and similar metadata structures); they do **not** change generated SpiceDB text.

### `@kesselExtension` (optional)

Registers the target model in a separate state set. **RBAC V1 discovery does not read this set**—it walks `V1WorkspacePermission` template instances and aliases. You can still use `@kesselExtension` for documentation or future tooling, but **permissions work without it**.

---

## 5. Output formats

Only three values are valid for `typespec-as-schema.output-format`:

| Value | Artifact | Purpose |
|-------|-----------|---------|
| `spicedb` (default) | `schema.zed` | Full SpiceDB schema text after expansion. |
| `metadata` | `metadata.json` | Per-application permission names, resource names, cascade policy summaries, and annotation key/value entries. Built from **pre-expansion** resources plus discovered permissions and decorators. |
| `unified-jsonschema` | `unified-jsonschemas.json` | JSON Schema fragments for service resources (`ExactlyOne` assignable relations → `*_id` UUID fields). Uses the **expanded** resource list; `rbac` is skipped by default. |

Example:

```bash
npm run build
tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata
tsp compile schema/main.tsp --option typespec-as-schema.output-format=unified-jsonschema
```

There is **no** IR bundle, **no** Go loader output, and **no** separate “annotations-only” emitter format in this package.

Strict validation (failed checks become compile errors):

```bash
tsp compile schema/main.tsp --option typespec-as-schema.strict=true
```

---

## 6. Add a new service (step-by-step)

1. **Choose shape:** permissions-only (aliases only) vs. resource types + data + policies.
2. **Add** `schema/<your-service>.tsp`.
3. **Imports (typical):**
   - Always: `kessel.tsp`, `kessel-extensions.tsp`, `rbac/rbac-extensions.tsp`, `rbac/rbac.tsp`.
   - If you use `@cascadePolicy` / `@annotation`: `decorators.tsp`.
   - If you use `@jsonSchema` data models: `@typespec/json-schema` and `using JsonSchema`.
4. **Register permissions:** one `alias` (or template instance) per `Kessel.V1WorkspacePermission<App, Res, Verb, v2Perm>` with lowercase app/resource and a snake_case `v2Perm`.
5. **Define resources** (if any): `namespace` for your app; models with `Assignable` / `Permission<SubRef<...>>`; align `SubRef` permission names with your V2 permission strings.
6. **Optional:** `@cascadePolicy` on `CascadeDeletePolicy<...>`; `@annotation` on `ResourceAnnotation<...>`.
7. **Wire:** `import "./<your-service>.tsp";` in `schema/main.tsp`.
8. **Verify:** `npm run build && tsp compile schema/main.tsp` and inspect `schema.zed` (or emit `metadata` / `unified-jsonschema` as needed).

**RBAC maintainers** (not most service teams) edit `schema/rbac/rbac.tsp`, `schema/rbac/rbac-extensions.tsp`, and the TypeScript expansion in `src/providers/rbac/rbac-provider.ts`.

---

## 7. Testing guidance

From the package root:

```bash
npm run test              # vitest run (full suite)
npx vitest run test/unit
npx vitest run test/integration
```

When changing discovery or expansion, add or extend tests under `test/`—for example, `discoverV1Permissions` is covered with **alias-only** fixtures in `test/unit/discover.test.ts`.

---

## Reference snippets

### `V1WorkspacePermission<App, Res, Verb, V2>`

Defined in `schema/rbac/rbac-extensions.tsp`. Maps a V1-style app/resource/verb tuple to a workspace-level V2 permission name. **Discovered** by walking the program for template instances and aliases; **no decorator required**.

### `CascadeDeletePolicy<ChildApp, ChildResource, ParentRelation>`

Declare cascade behavior; must use **`@cascadePolicy`** for discovery.

### `ResourceAnnotation<Application, Resource, Key, Value>`

Metadata only; must use **`@annotation`** for discovery and inclusion in `metadata.json`.

### Relation helpers (inside resource models)

| Form | Role |
|------|------|
| `Assignable<Target, Cardinality>` | Writable relation + default permission |
| `Permission<Expr>` | Computed permission |
| `BoolRelation<Target>` | Wildcard boolean relation |

Permission expressions use `SubRef<"relationName", "permName">`, unions, and intersections as in existing schemas.

### Safety (`src/safety.ts`)

**Expression validation only:** pre-expansion checks ensure permission bodies reference relations that exist on the same resource; post-expansion checks validate the full graph (optionally strict). There are **no** built-in complexity budgets, expansion timeouts, or output-size limits in this module.

---

## Naming conventions

| Element | Convention | Example |
|---------|------------|---------|
| Namespace | PascalCase in TypeSpec; lowercase segment in SpiceDB | `Inventory` → `inventory` |
| Resource model | PascalCase | `Host` → `inventory/host` |
| V2 permission | `{app}_{resource}_{action}` | `inventory_host_view` |
| Relation slot in Zed | `t_{relation}` | `t_workspace` |

---

## Pipeline checklist (`$onEmit`)

1. Discover resources, V1 permissions (template/alias), decorated cascade policies, decorated annotations.  
2. Pre-expansion expression validation on authored resources.  
3. RBAC expansion and delete scaffold wiring.  
4. Cascade-delete expansion.  
5. Post-expansion expression validation.  
6. Emit exactly one of: `schema.zed`, `metadata.json`, or `unified-jsonschemas.json`.
