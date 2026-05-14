# Add a V1 Workspace Permission

Guide for registering a new permission via the `@v1Permission` decorator.

## What This Does

Each `@v1Permission` triggers **exactly 7 mutations** on RBAC types:

1. `rbac/role` — 4 bool relations for the hierarchy (`app_any_any`, `app_res_any`, `app_any_verb`, `app_res_verb`)
2. `rbac/role` — 1 computed permission (union of the 4 hierarchy levels + `any_any_any`)
3. `rbac/role_binding` — 1 intersection permission (`subject & granted->v2perm`)
4. `rbac/workspace` — 1 union permission (`binding->v2perm + parent->v2perm`)
5. If verb is `"read"`, the permission is accumulated into `workspace.view_metadata`

Additionally, the emitter **auto-wires** a permission relation on the resource model:

| Verb | Auto-wired relation |
|------|---------------------|
| `read` | `view = t_workspace->v2Perm` |
| `write` | `update = t_workspace->v2Perm` |
| `create` | `create = t_workspace->v2Perm` |
| `delete` | `delete = t_workspace->v2Perm` |

## Steps

### 1. Add the decorator

On your resource model (or a standalone permissions model):

```typespec
@v1Permission("myapp", "widgets", "read", "myapp_widget_view")
model Widget {
  workspace: WorkspaceRef;
}
```

Parameters:
- `"myapp"` — application (lowercase)
- `"widgets"` — resource (plural, lowercase)
- `"read"` — verb: `"read"` | `"write"` | `"create"` | `"delete"`
- `"myapp_widget_view"` — v2 permission name (snake_case)

Multiple permissions on the same model:

```typespec
@v1Permission("myapp", "widgets", "read", "myapp_widget_view")
@v1Permission("myapp", "widgets", "write", "myapp_widget_update")
model Widget {
  workspace: WorkspaceRef;
}
```

### 2. No manual relation wiring needed

The emitter auto-wires permission relations based on the verb. You do **not** need to write:

```typespec
view: Permission<SubRef<"workspace", "myapp_widget_view">>;
```

This is injected automatically.

### 3. Verify

```bash
npm run build && npx tsp compile schema/main.tsp   # check SpiceDB output
npx vitest run                                       # run tests
```

## Naming Conventions

| Field | Convention | Example |
|-------|-----------|---------|
| application | lowercase, no underscores | `inventory`, `remediations` |
| resource | lowercase plural | `hosts`, `remediations` |
| verb | one of: `read`, `write`, `create`, `delete` | `read` |
| v2Perm | `{app}_{singular_resource}_{action}` | `inventory_host_view` |

## Common Patterns

**Read + write pair:**
```typespec
@v1Permission("myapp", "widgets", "read", "myapp_widget_view")
@v1Permission("myapp", "widgets", "write", "myapp_widget_update")
model Widget {
  workspace: WorkspaceRef;
}
```

**Permissions-only service** (no resource types, just permissions on workspace):
```typespec
@v1Permission("remediations", "remediations", "read", "remediations_remediation_view")
model RemediationsPermissions {}
```
