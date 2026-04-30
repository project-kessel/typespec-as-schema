# Add a V1 Workspace Permission

Guide for registering a new permission via the V1WorkspacePermission extension template.

## What This Does

Each `V1WorkspacePermission` alias triggers **exactly 7 mutations** on RBAC types:

1. `rbac/role` — 4 bool relations for the hierarchy (`app_any_any`, `app_res_any`, `app_any_verb`, `app_res_verb`)
2. `rbac/role` — 1 computed permission (union of the 4 hierarchy levels + `any_any_any`)
3. `rbac/role_binding` — 1 intersection permission (`subject & granted->v2perm`)
4. `rbac/workspace` — 1 union permission (`binding->v2perm + parent->v2perm`)
5. If verb is `"read"`, the permission is accumulated into `workspace.view_metadata`

## Steps

### 1. Add the alias

In your service's `.tsp` file:

```typespec
alias myNewPermission = Kessel.V1WorkspacePermission<
  "myapp",                    // application
  "widgets",                  // resource (plural form)
  "read",                     // verb: "read" | "write" | "create" | "delete"
  "myapp_widget_view"         // v2 permission name
>;
```

### 2. Reference in a resource (optional)

If this permission should be checkable on a resource:

```typespec
model Widget {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  view: Permission<"workspace.myapp_widget_view">;
}
```

The `Permission<"expr">` string follows the pattern: `<relation>.<permission_name>` where:
- `<relation>` is the local relation name (e.g., `workspace`)
- `<permission_name>` is the v2 permission name from the alias

### 3. Preview the expansion

```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp --preview myapp_widget_view
```

### 4. Verify

```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp   # check SpiceDB output
npx vitest run                                     # run tests
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
alias viewPerm = Kessel.V1WorkspacePermission<"myapp", "widgets", "read", "myapp_widget_view">;
alias updatePerm = Kessel.V1WorkspacePermission<"myapp", "widgets", "write", "myapp_widget_update">;
```

**Permissions-only service** (no resource types, just permissions on workspace):
```typespec
namespace Remediations;
alias viewPerm = Kessel.V1WorkspacePermission<"remediations", "remediations", "read", "remediations_remediation_view">;
```
