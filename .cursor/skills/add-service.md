# Add a New Service Schema

Guide for adding a new service to the Kessel TypeSpec schema.

## Steps

### 1. Create the service schema file

Create `schema/<service-name>.tsp`:

```typespec
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "./rbac.tsp";

using Kessel;

namespace <ServiceNamespace>;
```

### 2. Define V1WorkspacePermission aliases

For each legacy `application:resource:verb` triple, add an alias:

```typespec
alias viewPermission = Kessel.V1WorkspacePermission<
  "myapp",       // application (lowercase)
  "widgets",     // resource plural (lowercase)
  "read",        // verb: "read" | "write" | "create" | "delete"
  "myapp_widget_view"  // v2 permission name (snake_case)
>;
```

### 3. Define data fields (optional)

If the resource has reportable data, declare those fields directly on the
resource model with standard validation decorators:

```typespec
@format("uuid")
scalar WidgetId extends string;

model Widget {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  view: Permission<"workspace.myapp_widget_view">;
  update: Permission<"workspace.myapp_widget_update">;

  @format("uuid")
  external_id?: WidgetId;

  @maxLength(255)
  display_name?: string;
}
```

### 4. Define the resource model

The same flat model carries relations, data fields, and computed permissions.

### 5. Register in main.tsp

Add an import to `schema/main.tsp`:

```typespec
import "./myapp.tsp";
```

### 6. Verify

```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp
npx vitest run
```

## Checklist

- [ ] Service file created in `schema/`
- [ ] V1WorkspacePermission aliases for each permission
- [ ] Flat resource model with `workspace` relation, inline data fields, and computed permissions
- [ ] Imported in `main.tsp`
- [ ] Emitter runs without errors
- [ ] Tests pass
