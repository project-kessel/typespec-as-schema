# Add a New Service Schema

Guide for adding a new service to the Kessel TypeSpec schema.

## Steps

### 1. Create the service schema file

Create `schema/<service-name>.tsp`:

```typespec
import "@typespec/json-schema";
import "../lib/kessel.tsp";
import "../lib/kessel-extensions.tsp";
import "./rbac.tsp";

using JsonSchema;
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

If the resource has reportable data, create a `*Data` model with JSON Schema decorators:

```typespec
@jsonSchema
model WidgetData {
  @format("uuid")
  external_id?: string;

  @maxLength(255)
  display_name?: string;
}
```

### 4. Define the resource model

```typespec
model Widget {
  workspace: Assignable<RBAC.Workspace, Cardinality.ExactlyOne>;
  data: WidgetData;
  view: Permission<SubRef<"workspace", "myapp_widget_view">>;
  update: Permission<SubRef<"workspace", "myapp_widget_update">>;
}
```

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
- [ ] Resource model with `workspace` relation and computed permissions
- [ ] Imported in `main.tsp`
- [ ] Emitter runs without errors
- [ ] Tests pass
