# Extension Provider Guide

How the extension system works and how to add new providers.

---

## Architecture Overview

The extension system separates **declaration** (TypeSpec templates) from
**logic** (TypeScript providers). Service authors write TypeSpec aliases to
consume extensions. Provider teams write TypeScript expansion logic.

```
  SERVICE AUTHORS              PROVIDER TEAMS               PLATFORM
  (schema/*.tsp)               (schema/{provider}/)         (src/, lib/)
  ──────────────               ─────────────────            ──────────────
  Write alias                  Define template in .tsp;     Core types;
  declarations:                expansion logic in .ts;      pipeline;
  alias foo =                  uses @provider decorator     discover, validate,
    Provider.Template<         to self-register.            generate.
    "p1", "p2"
  >;

  Zero computation.            Provider-owned logic.        Provider-neutral
  Only type aliases.                                        infrastructure.
```

### Pipeline Lifecycle

The pipeline runs in this order:

```
1. Compile         TypeSpec → AST (via @typespec/compiler)
2. Enrich          Read @provider decorators → fill provider.templates + metadata
3. Discover        Per-provider: find template instances in the AST
4. Validate        Namespace cross-check, complexity budget, pre-expansion checks
5. Expand          Per-provider: mutate resource graph (provider order matters)
6. Cascade         onBeforeCascadeDelete hooks → expandCascadeDeletePolicies
7. Emit            Generate SpiceDB schema + unified JSON schemas
```

Providers are called in **array order** — later providers can reference
resources/permissions created by earlier ones. This is how HBI's
`ExposeHostPermission` can reference RBAC workspace permissions.

---

## What a Provider Consists Of

Every provider has two parts:

### 1. TypeSpec template (`.tsp`)

A generic model decorated with `@provider` that defines the extension's
parameters. Lives under `schema/{provider}/`.

```typespec
// schema/hbi/hbi-extensions.tsp
using Kessel;

namespace HBI;

@provider("hbi")
model ExposeHostPermission<V2Perm extends string, HostPerm extends string> {
  v2Perm: V2Perm;
  hostPerm: HostPerm;
}
```

The `@provider` decorator tells the pipeline which TypeScript provider owns
this template. The model's properties become the parameter names that service
authors fill in via aliases.

### 2. TypeScript provider (`.ts`)

A `defineProvider()` call that supplies the expansion logic. Lives alongside
the template.

```typescript
// schema/hbi/hbi-provider.ts
export const hbiProvider = defineProvider({
  id: "hbi",
  templates: [],
  expand: (resources, discovered) =>
    exposeHostPermissions(resources, discovered.map((d) => d.params as unknown as HostPermExtension)),
});
```

`templates: []` is intentional — the pipeline fills this from the `@provider`
decorator at compile time via `enrichProvidersFromDecorators`.

---

## The `@provider` Decorator

Declared in `lib/kessel-decorators.tsp`:

```typespec
extern dec provider(
  target: unknown,
  id: valueof string,
  ownedNamespace?: valueof string,
  costPerInstance?: valueof int32,
  applicationParam?: valueof string,
  permissionParam?: valueof string,
);
```

| Parameter | Required | Purpose |
|---|---|---|
| `id` | Yes | Must match the `id` in `defineProvider({ id: ... })` |
| `ownedNamespace` | No | Namespace to exclude from unified JSON schemas (e.g., `"rbac"`) |
| `costPerInstance` | No | Mutations per instance for complexity budget (default: 1) |
| `applicationParam` | No | Param key for namespace cross-checking (e.g., `"application"`) |
| `permissionParam` | No | Param key for permission metadata (e.g., `"v2Perm"`) |

**Minimal usage** (HBI — only `id`):
```typespec
@provider("hbi")
model ExposeHostPermission<...> { ... }
```

**Full usage** (RBAC — all options):
```typespec
@provider("rbac", "rbac", 7, "application", "v2Perm")
model V1WorkspacePermission<...> { ... }
```

---

## The `defineProvider` API

```typescript
import { defineProvider } from "../../src/define-provider.js";
```

### `ProviderConfig`

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Must match the `@provider` decorator's first argument |
| `templates` | `ExtensionTemplateDef[]` | Yes | Pass `[]` — auto-populated from `@provider` at compile time |
| `expand` | `(resources, discovered) => ProviderExpansionResult` | Yes | Core expansion logic |
| `ownedNamespaces` | `string[]` | No | Auto-populated from `@provider` decorator |
| `costPerInstance` | `number` | No | Auto-populated from `@provider` decorator |
| `applicationParamKey` | `string` | No | Auto-populated from `@provider` decorator |
| `permissionParamKey` | `string` | No | Auto-populated from `@provider` decorator |
| `onBeforeCascadeDelete` | `(resources) => ResourceDef[]` | No | Hook to wire scaffold relations before cascade expansion |
| `discover` | `(program) => DiscoveredExtension[]` | No | Custom discovery — if omitted, auto-discovers from templates |

### Auto-discovery

When `discover` is omitted (the common case), `defineProvider` generates one
automatically. It scans the compiled program for instances of each template in
`templates`, extracts parameter values, and returns them as
`DiscoveredExtension` objects:

```typescript
interface DiscoveredExtension {
  kind: string;               // template name (e.g., "ExposeHostPermission")
  params: Record<string, string>;  // extracted parameter values
}
```

### `ProviderExpansionResult`

The `expand` function must return:

```typescript
interface ProviderExpansionResult {
  resources: ResourceDef[];   // the mutated resource graph
  warnings: string[];         // any non-fatal issues to surface
}
```

Always clone before mutating — use `cloneResources(baseResources)` from
`src/utils.js`.

---

## Primitives for Expansion Logic

Providers use helpers from `src/primitives.ts` to build the resource graph:

| Primitive | Description | Example |
|---|---|---|
| `ref(name)` | Reference a relation by name | `ref("view")` |
| `subref(name, subname)` | Arrow reference: `name->subname` | `subref("workspace", "delete")` |
| `or(...members)` | Union of relations | `or(ref("a"), ref("b"))` |
| `and(...members)` | Intersection of relations | `and(ref("view"), subref("workspace", v2Perm))` |
| `addRelation(resource, rel)` | Append a relation to a resource | See below |
| `hasRelation(resource, name)` | Check if a relation already exists | `hasRelation(host, "view")` |

Utility helpers from `src/utils.js`:

| Utility | Description |
|---|---|
| `findResource(resources, namespace, name)` | Find a resource by namespace/name |
| `cloneResources(resources)` | Deep-clone the resource array for immutable expansion |

### Relation shapes

```typescript
// Boolean relation (wildcard — e.g., role permissions)
addRelation(role, { name: "my_perm", body: { kind: "bool", target: "rbac/principal" } });

// Computed permission (intersection)
addRelation(host, {
  name: "my_host_perm",
  body: and(ref("view"), subref("workspace", "my_workspace_perm")),
});

// Computed permission (union + inheritance)
addRelation(workspace, {
  name: "my_perm",
  body: or(subref("binding", "my_perm"), subref("parent", "my_perm")),
});
```

---

## Step-by-Step: Creating a New Provider

### Example: ContingentPermission provider

This provider creates workspace permissions that are the **intersection** of
two existing permissions. Production KSL equivalent:
`@rbac.add_contingent_permission(first, second, contingent)`.

#### Step 1: Create the template (`schema/contingent/contingent-extensions.tsp`)

```typespec
import "../../lib/kessel.tsp";

using Kessel;

namespace Contingent;

@provider("contingent")
model ContingentPermission<
  First extends string,
  Second extends string,
  Contingent extends string
> {
  first: First;
  second: Second;
  contingent: Contingent;
}
```

Key points:
- The `@provider("contingent")` decorator links this template to the provider ID.
- The model properties (`first`, `second`, `contingent`) become the parameter
  names that service authors use.
- `using Kessel;` brings the `@provider` decorator into scope.
- The namespace is the provider's own (e.g., `Contingent`), not `Kessel`.
  Template names only need to be unique within their namespace.

#### Step 2: Create the provider (`schema/contingent/contingent-provider.ts`)

```typescript
import type { ResourceDef } from "../../src/types.js";
import type { ProviderExpansionResult } from "../../src/provider.js";
import { defineProvider } from "../../src/define-provider.js";
import { and, ref, addRelation, hasRelation } from "../../src/primitives.js";
import { findResource, cloneResources } from "../../src/utils.js";

interface ContingentExtension {
  first: string;
  second: string;
  contingent: string;
}

function expandContingent(
  baseResources: ResourceDef[],
  extensions: ContingentExtension[],
): ProviderExpansionResult {
  const resources = cloneResources(baseResources);
  const workspace = findResource(resources, "rbac", "workspace");

  if (!workspace) {
    return { resources, warnings: ["Contingent: rbac/workspace not found — skipped."] };
  }

  for (const { first, second, contingent } of extensions) {
    if (hasRelation(workspace, contingent)) continue;
    addRelation(workspace, {
      name: contingent,
      body: and(ref(first), ref(second)),
    });
  }

  return { resources, warnings: [] };
}

export const contingentProvider = defineProvider({
  id: "contingent",
  templates: [],
  expand: (resources, discovered) =>
    expandContingent(
      resources,
      discovered.map((d) => d.params as unknown as ContingentExtension),
    ),
});
```

That's the entire provider — roughly 40 lines.

#### Step 3: Register in the composition roots

**CLI** (`src/spicedb-emitter.ts`):
```typescript
import { contingentProvider } from "../schema/contingent/contingent-provider.js";

const DEFAULT_PROVIDERS: ExtensionProvider[] = [rbacProvider, contingentProvider, hbiProvider];
```

**Tests** (`test/helpers/pipeline.ts`):
```typescript
import { contingentProvider } from "../../schema/contingent/contingent-provider.js";

export const DEFAULT_TEST_PROVIDERS = [rbacProvider, contingentProvider, hbiProvider];
```

Provider order matters: contingent must come after RBAC (it references
RBAC-created permissions) and before HBI (HBI may reference contingent
permissions).

#### Step 4: Import the template in `schema/main.tsp`

```typespec
import "./contingent/contingent-extensions.tsp";
```

#### Step 5: Use it from a service schema

```typespec
// schema/advisor.tsp
import "./rbac/rbac-extensions.tsp";
import "./contingent/contingent-extensions.tsp";
import "./hbi/hbi-extensions.tsp";

using Kessel;

namespace Advisor;

alias resultsViewAssigned = RBAC.V1WorkspacePermission<
  "advisor", "recommendation_results", "read",
  "advisor_recommendation_results_view_assigned"
>;

alias resultsView = Contingent.ContingentPermission<
  "inventory_host_view",
  "advisor_recommendation_results_view_assigned",
  "advisor_recommendation_results_view"
>;

alias exposeResultsView = HBI.ExposeHostPermission<
  "advisor_recommendation_results_view",
  "advisor_recommendation_results_view"
>;
```

Three alias lines, zero TypeScript from the service author.

---

## Provider Hooks

### `onBeforeCascadeDelete`

Called after all providers have expanded but before cascade-delete policies are
applied. Use this to wire scaffold relations that cascade-delete depends on.

RBAC uses this to ensure `delete` permissions exist on `role`, `role_binding`,
and `workspace` before the cascade expansion tries to reference them:

```typescript
export function wireDeleteScaffold(baseResources: ResourceDef[]): ResourceDef[] {
  const resources = cloneResources(baseResources);
  const role = findResource(resources, "rbac", "role");
  const roleBinding = findResource(resources, "rbac", "role_binding");
  const workspace = findResource(resources, "rbac", "workspace");
  if (!role || !roleBinding || !workspace) return resources;

  if (!hasRelation(role, "delete"))
    addRelation(role, { name: "delete", body: ref("any_any_any") });
  if (!hasRelation(roleBinding, "delete"))
    addRelation(roleBinding, { name: "delete", body: and(ref("subject"), subref("granted", "delete")) });
  if (!hasRelation(workspace, "delete"))
    addRelation(workspace, { name: "delete", body: or(subref("binding", "delete"), subref("parent", "delete")) });

  return resources;
}
```

Most providers won't need this hook.

---

## How Metadata Flows

The `@provider` decorator carries optional metadata that the pipeline uses:

| Metadata | Set via | Used for |
|---|---|---|
| `ownedNamespace` | `@provider("rbac", "rbac", ...)` | Excludes namespace from unified JSON schema output |
| `costPerInstance` | `@provider("rbac", "rbac", 7, ...)` | Complexity budget: `instances * cost <= limit` |
| `applicationParamKey` | `@provider("rbac", "rbac", 7, "application", ...)` | Namespace cross-check: warns if no resource matches the application |
| `permissionParamKey` | `@provider("rbac", "rbac", 7, "application", "v2Perm")` | Emitted in metadata output for downstream consumers |

If your provider doesn't need these (like HBI), just pass the `id`:
```typespec
@provider("hbi")
```

---

## Existing Providers at a Glance

### RBAC Provider

| | |
|---|---|
| **Template** | `RBAC.V1WorkspacePermission<App, Res, Verb, V2>` |
| **Decorator** | `@provider("rbac", "rbac", 7, "application", "v2Perm")` |
| **Expansion** | 7 mutations per instance across `role`, `role_binding`, `workspace` |
| **Hook** | `onBeforeCascadeDelete` wires `delete` scaffold |
| **Files** | `schema/rbac/rbac-extensions.tsp`, `schema/rbac/rbac-provider.ts` |

### HBI Provider

| | |
|---|---|
| **Template** | `HBI.ExposeHostPermission<V2Perm, HostPerm>` |
| **Decorator** | `@provider("hbi")` |
| **Expansion** | 1 mutation per instance on `inventory/host` |
| **Hook** | None |
| **Files** | `schema/hbi/hbi-extensions.tsp`, `schema/hbi/hbi-provider.ts` |

---

## Checklist: Adding a New Provider

1. Create `schema/{name}/{name}-extensions.tsp` with a `@provider`-decorated template model in its own namespace (with `using Kessel;` for decorator access)
2. Create `schema/{name}/{name}-provider.ts` with a `defineProvider()` call
3. Import the template in `schema/main.tsp`
4. Register the provider in `src/spicedb-emitter.ts` (CLI) and `test/helpers/pipeline.ts` (tests)
5. Place the provider in the correct position in the provider array (ordering matters for cross-provider references)
6. Add or update integration tests in `test/integration/`
