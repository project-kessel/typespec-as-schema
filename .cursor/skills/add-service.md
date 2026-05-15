# Add a New Service Schema

Guide for adding a new service to the Kessel TypeSpec schema.

## Steps

### 1. Create the service schema file

Create `schema/<service-name>.tsp`:

```typespec
import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;
using RBAC;

namespace <ServiceNamespace>;
```

The `lib/main.tsp` import brings in all Kessel types, RBAC types, and aliases. The `rbac-extensions.tsp` import brings in the `RBAC.V1WorkspacePermission` template and the `@v1Permission` decorator. `using RBAC;` lets you use `@v1Permission` without a namespace prefix.

### 2. Register permissions

**Decorator style (preferred)** -- attach `@v1Permission` directly on the resource model:

```typespec
@v1Permission("read", "widgets", "myapp", "myapp_widget_view")
@v1Permission("write", "widgets", "myapp", "myapp_widget_update")
model Widget {
  workspace: WorkspaceRef;
}
```

**Alias style (alternative)** -- for permissions-only services with no model:

```typespec
alias widgetView = RBAC.V1WorkspacePermission<"myapp", "widgets", "read", "myapp_widget_view">;
alias widgetUpdate = RBAC.V1WorkspacePermission<"myapp", "widgets", "write", "myapp_widget_update">;
```

The RBAC provider auto-discovers both forms and wires `view`/`update` relations automatically.

### 3. Define the resource model with inline data fields

Data fields live directly on the resource model alongside relations. No separate `*Data` model needed:

```typespec
model Widget {
  workspace: WorkspaceRef;

  @format("uuid") external_id?: string;
  @maxLength(255) display_name?: string;
}
```

The emitter extracts `Scalar` and `Union` properties as data fields for the unified JSON schema, with validation constraints (`@format`, `@maxLength`, `@pattern`) preserved.

### 4. Add policies and annotations (optional)

```typespec
@v1Permission("read", "widgets", "myapp", "myapp_widget_view")
@cascadeDelete("workspace")
@resourceAnnotation("retention_days", "365")
model Widget {
  workspace: WorkspaceRef;
  @maxLength(255) display_name?: string;
}
```

### 5. Register in main.tsp

Add an import to `schema/main.tsp`:

```typespec
import "./myapp.tsp";
```

### 6. Verify

```bash
make build && npx tsp compile schema/main.tsp
npx vitest run
```

## Full Example

```typespec
import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;
using RBAC;

namespace ContentSources;

@v1Permission("read", "templates", "content_sources", "content_sources_template_view")
@v1Permission("write", "templates", "content_sources", "content_sources_template_edit")
@cascadeDelete("workspace")
@resourceAnnotation("retention_days", "365")
model Template {
  workspace: WorkspaceRef;

  @maxLength(255) name?: string;
  @format("uri") repository_url?: string;
}
```

SpiceDB output includes RBAC expansion + auto-wired `view`/`update` + cascade `delete`.

## Checklist

- [ ] Service file created in `schema/`
- [ ] `import "../lib/main.tsp"` and `import "./rbac/rbac-extensions.tsp"`
- [ ] Permissions registered (decorator `@v1Permission` on model, or alias `RBAC.V1WorkspacePermission<...>`)
- [ ] Resource model with `workspace: WorkspaceRef` and inline data fields
- [ ] Optional: `@cascadeDelete`, `@resourceAnnotation`
- [ ] Imported in `schema/main.tsp`
- [ ] `make build && make run` works
- [ ] Tests pass (`npx vitest run`)
