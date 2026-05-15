# Add a New Service Schema

Guide for adding a new service to the Kessel TypeSpec schema.

## Steps

### 1. Create the service schema file

Create `schema/<service-name>.tsp`:

```typespec
import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;

namespace <ServiceNamespace>;
```

The `lib/main.tsp` import brings in all Kessel types, RBAC types, and aliases. The `rbac-extensions.tsp` import brings in the `RBAC.V1WorkspacePermission` template.

### 2. Register permissions with template aliases

For each legacy `application:resource:verb` triple, add an alias:

```typespec
alias widgetView = RBAC.V1WorkspacePermission<"myapp", "widgets", "read", "myapp_widget_view">;
alias widgetUpdate = RBAC.V1WorkspacePermission<"myapp", "widgets", "write", "myapp_widget_update">;
```

The RBAC provider auto-discovers these aliases via template scanning and wires `view`/`update` relations automatically.

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

namespace ContentSources;

alias templateView = RBAC.V1WorkspacePermission<"content_sources", "templates", "read", "content_sources_template_view">;
alias templateEdit = RBAC.V1WorkspacePermission<"content_sources", "templates", "write", "content_sources_template_edit">;

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
- [ ] Permission aliases: `RBAC.V1WorkspacePermission<...>`
- [ ] Resource model with `workspace: WorkspaceRef` and inline data fields
- [ ] Optional: `@cascadeDelete`, `@resourceAnnotation`
- [ ] Imported in `schema/main.tsp`
- [ ] `make build && make run` works
- [ ] Tests pass (`npx vitest run`)
