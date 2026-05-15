# TypeSpec-as-Schema Guide

End-to-end reference for **service developers** and **extension authors**.

---

## 1. Overview

Service teams write `.tsp` files declaring resources and permissions. Extension providers define expansion logic in TypeScript. A **TypeSpec emitter plugin** (`$onEmit`) orchestrates providers and compiles declarations into three outputs:

| Output | Option | Audience |
|--------|--------|----------|
| **SpiceDB** `schema.zed` | `spicedb` *(default)* | Authorization engine |
| **Metadata** `metadata.json` | `metadata` | Platform tooling |
| **Unified JSON Schema** `unified-jsonschemas.json` | `unified-jsonschema` | API servers/clients |

### Quick start

```bash
npm install
make build

npx tsp compile schema/main.tsp                                                          # SpiceDB (default)
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata        # metadata JSON
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=unified-jsonschema  # JSON Schema

npx vitest run       # tests
make run             # all outputs at once
```

---

## 2. Folder structure

```
typespec-as-schema/
├── lib/                          ← PLATFORM-OWNED
│   ├── main.tsp                    Single-import facade
│   ├── kessel.tsp                  Core types: Assignable, Permission, BoolRelation, Cardinality
│   ├── kessel-extensions.tsp       Platform templates: CascadeDeletePolicy, ResourceAnnotation
│   ├── decorators.tsp              Platform decorators: @cascadeDelete, @resourceAnnotation
│   └── aliases.tsp                 Pre-composed aliases: WorkspaceRef
│
├── schema/                       ← SERVICE AUTHORS + EXTENSION AUTHORS
│   ├── main.tsp                    Entrypoint — imports everything
│   ├── remediations.tsp            Permissions-only service (template aliases)
│   ├── rbac/
│   │   ├── rbac.tsp                Core RBAC types: Principal, Role, RoleBinding, Workspace
│   │   ├── rbac-extensions.tsp     V1WorkspacePermission template + extern dec v1Permission
│   │   └── rbac-provider.ts        RBAC expansion logic + $v1Permission decorator impl
│   └── hbi/
│       ├── hbi.tsp                 Host resource with data fields and @v1Permission decorators
│       ├── hbi-extensions.tsp      ExposeHostPermission template + extern dec exposeHostPermission
│       └── hbi-provider.ts         HBI expansion logic + $exposeHostPermission decorator impl
│
├── scripts/                      ← BUILD TOOLING
│   └── gen-decorator-wiring.mjs    Scans providers for $decorator exports, generates barrel
│
├── src/                          ← PLATFORM-OWNED
│   ├── index.ts                    Package entry: $lib, $onEmit, decorators
│   ├── _provider-decorators.ts     (generated) Re-exports provider $decorators
│   ├── emitter.ts                  $onEmit — orchestrates providers
│   ├── provider.ts                 ExtensionProvider interface
│   ├── define-provider.ts          defineProvider helper + validParams + decorator config
│   ├── discover-templates.ts       Template instance discovery (AST + alias scanning)
│   ├── discover-resources.ts       Resource extraction + data field extraction
│   ├── discover-decorated.ts       Cascade policies + annotations from decorators
│   ├── types.ts                    ResourceDef, DataFieldDef, RelationBody, etc.
│   ├── primitives.ts               ref, subref, or, and, addRelation, hasRelation
│   ├── resource-graph.ts           ResourceGraph wrapper (optional utility)
│   ├── utils.ts                    bodyToZed, slotName, cloneResources, findResource
│   ├── expand-cascade.ts           Cascade-delete expansion
│   ├── generate.ts                 SpiceDB, metadata, JSON Schema generators
│   ├── safety.ts                   Pre/post-expansion validation
│   ├── decorators.ts               Platform decorator implementations
│   └── lib.ts                      Emitter library, StateKeys, barrel exports
│
└── test/
    ├── unit/                       Per-module tests
    ├── integration/                Full pipeline + golden file tests
    └── helpers/pipeline.ts         compilePipeline() test runner
```

---

## 3. Pipeline flow

`tsp compile` loads the program; `$onEmit` orchestrates providers:

```
schema/main.tsp
       │
       ▼
 ┌─────────────────────────────┐
 │  1. TypeSpec Compiler        │
 │  .tsp → Program (types +    │
 │  decorator state maps)       │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  2. Resource Discovery       │
 │  discoverResources()         │
 │  (extracts relations +       │
 │   data fields from models)   │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  3. Provider Loop            │
 │  For each provider:          │
 │    discover(program) → ext[] │
 │    (templates + decorators,  │
 │     deduplicated)            │
 │    expand(resources, ext[])  │
 │      → { resources, warn }   │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  4. Cascade-Delete Scaffold  │
 │  provider.onBeforeCascade()  │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  5. Cascade-Delete Expansion │
 │  @cascadeDelete → subref     │
 └──────────────┬──────────────┘
                ▼
 ┌─────────────────────────────┐
 │  6. Generate + Emit          │
 │  spicedb | metadata |        │
 │  unified-jsonschema          │
 └─────────────────────────────┘
```

---

## 4. Service developer guide

### Permissions-only service

```typespec
// schema/notifications.tsp
import "../lib/main.tsp";
import "./rbac/rbac-extensions.tsp";

using Kessel;

namespace Notifications;

alias notifView = RBAC.V1WorkspacePermission<"notifications", "notifications", "read", "notifications_notification_view">;
alias notifUpdate = RBAC.V1WorkspacePermission<"notifications", "notifications", "write", "notifications_notification_update">;
```

Wire in `schema/main.tsp`:
```typespec
import "./notifications.tsp";
```

**Effort: 1 file, ~10 lines, zero TypeScript.**

### Full resource with data fields (decorator style -- preferred)

When a resource model exists, use `@v1Permission` decorators directly on the model:

```typespec
// schema/content-sources.tsp
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

Permissions, cascade policies, and annotations are all co-located on the model.

Data fields (`name`, `repository_url`) are extracted automatically into the unified JSON schema with validation constraints. Relations and permissions go to SpiceDB.

**Effort: 1 file, ~20 lines, zero TypeScript.**

### Full resource with data fields (alias style -- alternative)

Template aliases work identically but live outside the model. Useful when you prefer separation:

```typespec
// schema/content-sources.tsp
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

### Checklist

1. Create `schema/<your-service>.tsp`
2. Import `../lib/main.tsp` and `./rbac/rbac-extensions.tsp`
3. Register permissions -- **choose one style:**
   - **Decorator (preferred):** `using RBAC;` then `@v1Permission(verb, resource, app, v2Perm)` on model
   - **Alias:** `alias x = RBAC.V1WorkspacePermission<app, resource, verb, v2Perm>;`
4. Define resource model with `workspace: WorkspaceRef` and data fields
5. Optional: `@cascadeDelete("workspace")`, `@resourceAnnotation("key", "value")`
6. Wire: add `import "./<your-service>.tsp"` in `schema/main.tsp`
7. Verify: `make build && make run`

---

## 5. Extension author guide

Extensions are TypeSpec model templates + TypeScript expansion logic. Any team can define a new extension type. Providers can also export decorator functions so schema authors can write `@myDecorator(...)` on models.

### What you write

**1. A TypeSpec template + extern dec** (`schema/<team>/<team>-extensions.tsp`):

```typespec
import "../../lib/kessel.tsp";

using TypeSpec.Reflection;

namespace MyTeam;

// Decorator declaration (resolved from package entry via codegen)
extern dec myExtension(
  target: Model,
  param1: valueof string,
  param2: valueof string,
);

// Template (for alias-based usage)
model MyExtension<Param1 extends string, Param2 extends string> {
  param1: Param1;
  param2: Param2;
}
```

**2. A provider with decorator impl** (`schema/<team>/<team>-provider.ts`):

```typescript
import type { DecoratorContext, Model } from "@typespec/compiler";
import { setTypeSpecNamespace } from "@typespec/compiler";
import type { ResourceDef } from "../../src/types.js";
import type { ProviderExpansionResult } from "../../src/provider.js";
import { $lib } from "../../src/lib.js";
import { defineProvider, validParams } from "../../src/define-provider.js";
import { addRelation, ref } from "../../src/primitives.js";
import { findResource, cloneResources } from "../../src/utils.js";

// ─── Decorator ───────────────────────────────────────────────────────

const MyExtStateKey = $lib.createStateSymbol("myExtension");

export function $myExtension(
  context: DecoratorContext,
  target: Model,
  param1: string,
  param2: string,
) {
  const map = context.program.stateMap(MyExtStateKey);
  const existing = (map.get(target) as Record<string, string>[] | undefined) ?? [];
  existing.push({ param1, param2 });
  map.set(target, existing);
}

setTypeSpecNamespace("MyTeam", $myExtension);

// ─── Expansion logic ─────────────────────────────────────────────────

interface MyParams {
  param1: string;
  param2: string;
}

const KEYS = ["param1", "param2"] as const;

function expandMyExtension(baseResources: ResourceDef[], extensions: MyParams[]): ProviderExpansionResult {
  const resources = cloneResources(baseResources);
  // ... mutation logic using addRelation, findResource, etc.
  return { resources, warnings: [] };
}

export const myProvider = defineProvider({
  id: "myteam",
  templates: [{
    templateName: "MyExtension",
    paramNames: ["param1", "param2"],
    namespace: "MyTeam",
  }],
  decorators: [{ stateKey: MyExtStateKey, kind: "MyExtension" }],
  expand: (resources, discovered) =>
    expandMyExtension(resources, validParams<MyParams>(discovered, KEYS)),
});
```

**3. Register** in `src/emitter.ts` (one import + one array entry):

```typescript
import { myProvider } from "../schema/myteam/myteam-provider.js";

const providers = [rbacProvider, hbiProvider, myProvider];
```

**4. Build** -- `make build` runs the codegen script (`scripts/gen-decorator-wiring.mjs`) which scans provider files for `export function $` patterns and generates `src/_provider-decorators.ts` with re-exports. This wires your decorator into the package entry point automatically.

**5. Service schemas use it** via decorators (preferred) or template aliases:

```typespec
import "./myteam/myteam-extensions.tsp";

using MyTeam;

// Decorator style (preferred when a model exists)
@myExtension("value1", "value2")
model Widget { ... }

// Alias style (alternative, works without a model)
alias myThing = MyTeam.MyExtension<"value1", "value2">;
```

### How discovery works

`defineProvider` auto-generates discovery from **two sources**, deduplicated:

1. **Template scanning** -- walks the compiled program for models matching the template name + namespace, resolves aliases that instantiate the template, extracts parameter values
2. **Decorator state** -- reads from TypeSpec state maps populated by `$decorator` functions at compile time

Both sources produce `DiscoveredExtension[]` entries. If the same extension is registered by both a decorator and a template alias, it is deduplicated by parameter hash.

Results are passed to your `expand` function via `validParams<T>()`.

### Key utilities

| Function | Purpose |
|----------|---------|
| `cloneResources(resources)` | Deep-copy resources for immutable expansion |
| `findResource(resources, ns, name)` | Find a resource by namespace + name |
| `addRelation(resource, relDef)` | Add a relation to a resource |
| `hasRelation(resource, name)` | Check if a relation exists |
| `ref(name)` | Create a `{ kind: "ref" }` body |
| `subref(rel, sub)` | Create a `{ kind: "subref" }` body |
| `or(...bodies)` | Union of relation bodies |
| `and(...bodies)` | Intersection of relation bodies |
| `validParams<T>(discovered, keys, validate?)` | Type-safe param extraction |

---

## 6. Decorators

### Platform decorators

These are platform-owned, available to all services via `using Kessel;`:

| Decorator | Apply to | Purpose |
|-----------|----------|---------|
| `@cascadeDelete(parentRelation)` | Model | When parent is deleted, authorization cascades to this child |
| `@resourceAnnotation(key, value)` | Model | Key/value metadata in `metadata.json`; no SpiceDB effect |

### Provider decorators

These are defined by extension providers and wired automatically via build-time codegen. Use the provider's namespace (`using RBAC;`) or qualify (`@RBAC.v1Permission`):

| Decorator | Provider | Namespace | Purpose |
|-----------|----------|-----------|---------|
| `@v1Permission(verb, resource, application, v2Perm)` | RBAC | `RBAC` | Register a V1 workspace permission on a resource model |
| `@exposeHostPermission(v2Perm, hostPerm)` | HBI | `HBI` | Expose a workspace permission on the host resource |

Provider decorators are equivalent to their template alias counterparts but attach directly to the model for better co-location.

---

## 7. Current extension providers

### RBAC (`schema/rbac/`)

- **Template:** `RBAC.V1WorkspacePermission<App, Res, Verb, V2Perm>`
- **Decorator:** `@v1Permission(verb, resource, application, v2Perm)` (requires `using RBAC;`)
- **Expansion:** 7 mutations per permission across role / role_binding / workspace
- **Auto-wires:** view/update relations on service resources
- **Cascade scaffold:** Ensures delete permissions on RBAC types before cascade expansion

### HBI (`schema/hbi/`)

- **Template:** `HBI.ExposeHostPermission<V2Perm, HostPerm>`
- **Decorator:** `@exposeHostPermission(v2Perm, hostPerm)` (requires `using HBI;`)
- **Expansion:** Adds computed permission to inventory/host gated on view + workspace permission

---

## 8. Testing

```bash
npx vitest run              # full suite
npx vitest run test/unit    # unit only
npx vitest run test/integration  # integration only
make run                    # compile all outputs
```

Key test files:
- `expand.test.ts` — V1 expansion + cascade
- `declarative-extensions.test.ts` — provider discovery + full pipeline
- `benchmark.test.ts` — golden file comparison

---

## 9. Summary: who does what

| Task | Who | Files touched | TypeScript? |
|---|---|---|---|
| New permissions-only service | Service team | 1 `.tsp` + 1 import in `main.tsp` | No |
| New resource with data fields | Service team | 1 `.tsp` (decorators or aliases) | No |
| Cascade delete / annotation | Service team | Decorators on model | No |
| New extension type | Extension team | 1 `.tsp` (template + `extern dec`) + 1 provider `.ts` (`$decorator` + expansion) + 1 import in emitter | Yes |
| Platform changes | Platform team | `src/` | Yes |
