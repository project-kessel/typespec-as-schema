# TypeSpec-as-Schema: Design Document

**Status:** Implemented  
**Scope:** `typespec-as-schema/` — Kessel Schema POC using TypeSpec as the declarative schema language.

---

## Overview

This POC explores TypeSpec as the single source of truth for Kessel authorization schemas. Service teams write `.tsp` declarations; a registered TypeSpec emitter plugin produces SpiceDB schemas, per-service metadata, and unified JSON Schema — the same three outputs as the sibling Starlark and CUE POCs.

### Design Goals

1. **Zero computation in service schema** — Service authors write only type declarations and alias instantiations. All expansion logic lives in reviewed platform code.
2. **Bounded, deterministic expansion** — Each RBAC permission produces exactly 7 mutations. Cascade-delete policies produce exactly 1. The graph is finite and predictable.
3. **Compiler-guaranteed discovery** — Custom decorators (`@cascadePolicy`, `@annotation`) populate compiler state sets. Discovery reads those sets rather than performing fragile name matching.
4. **Single compilation pass** — `tsp compile` runs the emitter, producing one output format per invocation. No separate CLI, no Node.js scripts beyond the compiler.

---

## Architecture

### Emitter Plugin Model

The package exports a registered TypeSpec emitter plugin:

```
package.json
  "tspMain": "lib/kessel.tsp"       ← TypeSpec types
  "exports": { ".": "./dist/index.js" }  ← JS entry ($lib, $onEmit, decorators)
```

The TypeSpec compiler loads the package, resolves `extern dec` implementations, and calls `$onEmit` after compilation completes.

### Module Responsibilities

| Module | Role |
|--------|------|
| `src/index.ts` | Package entry — exports `$lib`, `$onEmit`, `$kesselExtension`, `$cascadePolicy`, `$annotation` |
| `src/lib.ts` | Emitter library definition (`createTypeSpecLibrary`), `StateKeys`, barrel re-exports |
| `src/emitter.ts` | `$onEmit` — pipeline orchestrator |
| `src/types.ts` | Core interfaces: `ResourceDef`, `RelationBody`, `ServiceMetadata`, etc. |
| `src/primitives.ts` | Graph builders: `ref`, `subref`, `or`, `and`, `addRelation`, `hasRelation` |
| `src/utils.ts` | Helpers: `bodyToZed`, `slotName`, `flattenAnnotations`, `extractParams` |
| `src/decorators.ts` | Decorator implementations: `$cascadePolicy`, `$annotation`, `$kesselExtension` |
| `src/discover-resources.ts` | Walks the TypeSpec type graph → `ResourceDef[]` |
| `src/discover-decorated.ts` | Reads decorator state sets → `CascadeDeleteEntry[]`, `AnnotationEntry[]` |
| `src/expand-cascade.ts` | Adds `delete` permissions from `CascadeDeletePolicy` declarations |
| `src/generate.ts` | `generateSpiceDB`, `generateMetadata`, `generateUnifiedJsonSchemas` |
| `src/safety.ts` | Pre/post-expansion permission expression validation |
| `src/providers/rbac/rbac-provider.ts` | `discoverV1Permissions`, `expandV1Permissions`, `wireDeleteScaffold` |

---

## Pipeline Stages

The `$onEmit` function in `src/emitter.ts` orchestrates six stages:

### 1. Discovery

Four independent discovery passes extract structured data from the compiled `Program`:

| Function | Input | Output |
|----------|-------|--------|
| `discoverResources(program)` | Type graph walk | `ResourceDef[]` |
| `discoverV1Permissions(program)` | Template/alias walking | `V1Extension[]` |
| `discoverDecoratedCascadePolicies(program)` | `StateKeys.cascadePolicy` state set | `CascadeDeleteEntry[]` |
| `discoverDecoratedAnnotations(program)` | `StateKeys.annotation` state set | `Map<string, AnnotationEntry[]>` |

**Note:** RBAC V1 permissions use template/alias walking (finds `V1WorkspacePermission` instances). The `@kesselExtension` decorator exists but is not required for RBAC discovery.

### 2. Pre-Expansion Validation

`validatePreExpansionExpressions(resources)` checks that every `ref` and `subref` in permission expressions resolves to a known local relation — catching typos before expansion mutates the graph. Failures produce warnings.

### 3. RBAC Expansion

`expandV1Permissions(resources, permissions)` — For each `V1Extension`, adds exactly 7 relations:
- 4 bool relations on Role (hierarchy levels)
- 1 OR permission on Role
- 1 AND permission on RoleBinding
- 1 OR permission on Workspace

Plus: read-verb permissions accumulate into `view_metadata` on Workspace.

`wireDeleteScaffold(resources)` — Adds `delete` permissions to Role, RoleBinding, and Workspace.

### 4. Cascade-Delete Expansion

`expandCascadeDeletePolicies(resources, cascadePolicies)` — For each `CascadeDeleteEntry`, adds a `delete` permission on the child resource as `subref(parentRelation, "delete")`.

### 5. Post-Expansion Validation

`validatePermissionExpressions(fullSchema)` — Cross-type `subref` validation on the fully expanded graph. In strict mode, failures become compiler errors.

### 6. Output Generation

One format per invocation:

| Format | Generator | Input | Output file |
|--------|-----------|-------|-------------|
| `spicedb` | `generateSpiceDB(fullSchema)` | Expanded graph | `schema.zed` |
| `metadata` | `generateMetadata(resources, permissions, ...)` | Pre-expansion resources | `metadata.json` |
| `unified-jsonschema` | `generateUnifiedJsonSchemas(fullSchema, ownedNamespaces)` | Expanded graph | `unified-jsonschemas.json` |

**Key distinction:** Metadata uses the pre-expansion `resources` (to reflect what services declared) plus discovered permissions, annotations, and cascade policies. SpiceDB and JSON Schema use the fully expanded graph.

---

## Extension Model

### How V1WorkspacePermission Works

The RBAC extension uses a **template-as-data-carrier** pattern:

1. **Template definition** (`schema/rbac/rbac-extensions.tsp`) — A parameterized TypeSpec model with no computation
2. **Service usage** (`schema/hbi.tsp`) — Alias declarations that instantiate the template
3. **Discovery** (`rbac-provider.ts`) — Walks the AST for template instances and resolves alias statements
4. **Expansion** (`rbac-provider.ts`) — 7 bounded mutations per instance

### How Decorators Work

Platform extensions (`CascadeDeletePolicy`, `ResourceAnnotation`) use custom decorators:

1. **Declaration** (`lib/decorators.tsp`) — `extern dec cascadePolicy(target: Model)`
2. **Implementation** (`src/decorators.ts`) — Adds target to `StateKeys.cascadePolicy` state set
3. **Discovery** (`src/discover-decorated.ts`) — Reads state set, extracts parameters from model properties
4. **Expansion** (`src/expand-cascade.ts`) — Adds delete permission on child resource

### Adding a New Extension

1. Define a template model in `lib/kessel-extensions.tsp`
2. Add a decorator in `lib/decorators.tsp` + implement in `src/decorators.ts`
3. Add discovery logic in `src/discover-decorated.ts`
4. Add expansion logic (if any)
5. Wire into `src/emitter.ts`

---

## Output Formats

| Output | Audience | Content |
|--------|----------|---------|
| **SpiceDB** (`.zed`) | Authorization engine | Full schema with definitions, permissions, relations |
| **Metadata** (`.json`) | Platform tooling | Per-service: permissions list, resource names, cascade policies, annotations |
| **Unified JSON Schema** (`.json`) | API servers/clients | Per-resource payload contracts (fields from `ExactlyOne` assignable relations) |

---

## Comparison with Other POCs

| Aspect | TypeSpec | Starlark | CUE |
|--------|----------|----------|-----|
| Schema language | TypeSpec (.tsp) | Starlark (.star) | CUE (.cue) |
| Outputs | 3 (same) | 3 (same) | 3 (same) |
| Expansion engine | TypeScript emitter plugin | Go interpreter | Go evaluator |
| Type checking | Compiler-enforced | Runtime | Schema validation |
| Extension mechanism | Decorators + templates | Function calls | Definitions |
| IDE support | TypeSpec language server | Limited | CUE LSP |
| CI dependency | Node.js | Go | Go |

All three POCs produce identical output categories: SpiceDB schema, metadata JSON, and unified JSON Schema. The TypeSpec POC uses the TypeSpec compiler's plugin infrastructure; the others use Go interpreters that directly walk their DSL and produce outputs.

---

## Design Decisions

### Why decorators for cascade/annotations but not RBAC

RBAC V1 permissions are discovered via template/alias walking because:
- Service teams already use `alias` declarations (zero-friction adoption)
- The RBAC provider needs to resolve template parameters from both `model ... is Template<>` and `alias ... = Template<>` forms
- Adding `@kesselExtension` on every alias would be redundant ceremony

Cascade policies and annotations use decorators because:
- They are platform-neutral (not provider-owned)
- Decorator state sets provide compiler-guaranteed discovery
- The `model ... is Template<> {}` form works naturally with decorators

### Why a single RBAC provider called directly

There is currently only one extension provider (RBAC). The emitter calls its functions directly rather than through an abstract provider interface. If additional providers are needed, a provider registry can be reintroduced.

### Why three separate output formats

The TypeSpec, Starlark, and CUE POCs all produce the same three standalone outputs. A previously-implemented bundled IR format was removed because it added complexity unique to TypeSpec without value over running `tsp compile` with different `output-format` options.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Node.js dependency in CI | TypeSpec compiler is the only runtime; no additional CLI scripts |
| Schema growth | Bounded expansion (7 mutations per V1, 1 per cascade). Linear total work. |
| Discovery fragility (RBAC) | Template walking handles both `model` and `alias` forms; integration tests verify |
| Cross-type reference errors | Post-expansion validation catches stale subrefs; strict mode halts compilation |
| TypeSpec version coupling | Minimal API surface used (compile, navigateProgram, emitFile) |
