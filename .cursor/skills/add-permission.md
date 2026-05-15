# Add a V1 Workspace Permission

Guide for registering a new permission via the `@v1Permission` decorator or `V1WorkspacePermission` template alias.

## What This Does

Each permission registration triggers **exactly 7 mutations** on RBAC types:

1. `rbac/role` — 4 bool relations for the hierarchy (`app_any_any`, `app_res_any`, `app_any_verb`, `app_res_verb`)
2. `rbac/role` — 1 computed permission (union of the 4 hierarchy levels + `any_any_any`)
3. `rbac/role_binding` — 1 intersection permission (`subject & granted->v2perm`)
4. `rbac/workspace` — 1 union permission (`binding->v2perm + parent->v2perm`)
5. If verb is `"read"`, the permission is accumulated into `workspace.view_metadata`

Additionally, the RBAC provider **auto-wires** a permission relation on the resource model:

| Verb | Auto-wired relation |
|------|---------------------|
| `read` | `view = t_workspace->v2Perm` |
| `write` | `update = t_workspace->v2Perm` |
| `create` | `create = t_workspace->v2Perm` |
| `delete` | `delete = t_workspace->v2Perm` |

## Steps

### Option A: Decorator style (preferred when a model exists)

Use `@v1Permission` directly on the resource model. Requires `using RBAC;`:

```typespec
import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;
using RBAC;

namespace MyApp;

@v1Permission("read", "widgets", "myapp", "myapp_widget_view")
@v1Permission("write", "widgets", "myapp", "myapp_widget_update")
model Widget {
  workspace: WorkspaceRef;
}
```

Parameters (in order):
- `"read"` — verb: `"read"` | `"write"` | `"create"` | `"delete"`
- `"widgets"` — resource (plural, lowercase)
- `"myapp"` — application (lowercase)
- `"myapp_widget_view"` — v2 permission name (snake_case)

### Option B: Template alias style (for permissions-only services)

Use aliases when there is no model to attach decorators to:

```typespec
import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;

namespace MyApp;

alias widgetView = RBAC.V1WorkspacePermission<"myapp", "widgets", "read", "myapp_widget_view">;
alias widgetUpdate = RBAC.V1WorkspacePermission<"myapp", "widgets", "write", "myapp_widget_update">;
```

Template alias parameters (in order): `<application, resource, verb, v2Perm>`.

### 2. No manual relation wiring needed

The RBAC provider auto-wires permission relations based on the verb. You do **not** need to write:

```typespec
view: Permission<SubRef<"workspace", "myapp_widget_view">>;
```

This is injected automatically by the provider.

### 3. Verify

```bash
make build && npx tsp compile schema/main.tsp   # check SpiceDB output
npx vitest run                                    # run tests
```

## Naming Conventions

| Field | Convention | Example |
|-------|-----------|---------|
| application | lowercase, no underscores | `inventory`, `remediations` |
| resource | lowercase plural | `hosts`, `remediations` |
| verb | one of: `read`, `write`, `create`, `delete` | `read` |
| v2Perm | `{app}_{singular_resource}_{action}` | `inventory_host_view` |

## Common Patterns

**Read + write pair (decorator style):**

```typespec
@v1Permission("read", "widgets", "myapp", "myapp_widget_view")
@v1Permission("write", "widgets", "myapp", "myapp_widget_update")
model Widget {
  workspace: WorkspaceRef;
}
```

**Read + write pair (alias style):**

```typespec
alias widgetView = RBAC.V1WorkspacePermission<"myapp", "widgets", "read", "myapp_widget_view">;
alias widgetUpdate = RBAC.V1WorkspacePermission<"myapp", "widgets", "write", "myapp_widget_update">;

model Widget {
  workspace: WorkspaceRef;
}
```

**Permissions-only service** (no resource types, must use aliases):

```typespec
alias remView = RBAC.V1WorkspacePermission<"remediations", "remediations", "read", "remediations_remediation_view">;
alias remUpdate = RBAC.V1WorkspacePermission<"remediations", "remediations", "write", "remediations_remediation_update">;
```
