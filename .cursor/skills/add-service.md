# Add a New Service Schema

Guide for adding a new service to the Kessel TypeSpec schema.

## Steps

### 1. Create the service schema file

Create `schema/<service-name>.tsp`:

```typespec
import "../lib/main.tsp";

using Kessel;

namespace <ServiceNamespace>;
```

The single `lib/main.tsp` import brings in all Kessel types, RBAC types, decorators, and aliases.

### 2. Register permissions with decorators

For each legacy `application:resource:verb` triple, add a `@v1Permission` decorator:

```typespec
@v1Permission("myapp", "widgets", "read", "myapp_widget_view")
@v1Permission("myapp", "widgets", "write", "myapp_widget_update")
model Widget {
  workspace: WorkspaceRef;
}
```

The emitter auto-wires `view` and `update` relations based on the verb — no manual `Permission<SubRef<...>>` declarations needed.

### 3. Define data fields (optional)

If the resource has reportable data, create a `*Data` model with JSON Schema decorators:

```typespec
import "@typespec/json-schema";

@jsonSchema
model WidgetData {
  @format("uuid")
  external_id?: string;

  @maxLength(255)
  display_name?: string;
}
```

Then reference it on the resource model:

```typespec
model Widget {
  workspace: WorkspaceRef;
  data: WidgetData;
}
```

### 4. Add policies and annotations (optional)

```typespec
@cascadeDelete("workspace")
@resourceAnnotation("retention_days", "365")
model Widget {
  workspace: WorkspaceRef;
  data: WidgetData;
}
```

### 5. Register in main.tsp

Add an import to `schema/main.tsp`:

```typespec
import "./myapp.tsp";
```

### 6. Verify

```bash
npm run build && npx tsp compile schema/main.tsp
npx vitest run
```

## Full Example

```typespec
import "@typespec/json-schema";
import "../lib/main.tsp";

using JsonSchema;
using Kessel;

namespace ContentSources;

@jsonSchema
model TemplateData {
  @maxLength(255) name?: string;
  @format("uri") repository_url?: string;
}

@v1Permission("content_sources", "templates", "read", "content_sources_template_view")
@v1Permission("content_sources", "templates", "write", "content_sources_template_edit")
@cascadeDelete("workspace")
@resourceAnnotation("retention_days", "365")
model Template {
  workspace: WorkspaceRef;
  data: TemplateData;
}
```

## Checklist

- [ ] Service file created in `schema/`
- [ ] `@v1Permission` decorators for each permission
- [ ] Resource model with `workspace: WorkspaceRef`
- [ ] Imported in `main.tsp`
- [ ] `npm run build && npx tsp compile schema/main.tsp` runs without errors
- [ ] Tests pass (`npx vitest run`)
