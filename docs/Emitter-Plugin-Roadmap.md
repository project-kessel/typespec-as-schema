# TypeSpec Emitter Plugin — Implementation Notes

This document records the architecture decisions made during the migration from a standalone CLI to a registered TypeSpec emitter plugin.

---

## Current Architecture

The Kessel schema emitter is a **registered TypeSpec emitter plugin** (`$onEmit`) with custom decorators.

```
schema/*.tsp ──> tsp compile ──> Program ──> $onEmit ──> discover ──> expand ──> validate ──> emit
                                 (AST + state sets)       (decorator-based)       (safety)     (files)
```

Key properties:

- **Plugin entry point**: `src/index.ts` exports `$lib`, `$onEmit`, and decorator implementations (`$cascadePolicy`, `$annotation`).
- **Compiler-managed lifecycle**: The TypeSpec compiler calls `$onEmit` after compilation, providing an `EmitContext` with the compiled `Program` and resolved emitter options.
- **Decorator-based discovery**: `@cascadePolicy` and `@annotation` tag models into compiler state sets, eliminating brittle name-based matching.
- **Emitter options**: `output-format` (`spicedb` | `metadata` | `unified-jsonschema`) and `strict` (boolean) are defined via `createTypeSpecLibrary` and validated by the compiler.
- **Testable**: Unit tests call pure functions on data structures. Integration tests call `compilePipeline()` which mirrors the emitter pipeline.

---

## Package Structure

```json
{
  "tspMain": "lib/kessel.tsp",
  "exports": {
    ".": "./dist/index.js"
  }
}
```

The compiler resolves the package for both:
- TypeSpec types (via `tspMain` → `lib/kessel.tsp`)
- JS emitter (via `exports["."]` → `dist/index.js` which exports `$lib`, `$onEmit`, decorators)

---

## Library Definition

`src/lib.ts` defines the emitter library:

```typescript
export const $lib = createTypeSpecLibrary({
  name: "typespec-as-schema",
  diagnostics: {
    "invalid-permission-expr": {
      severity: "error",
      messages: { default: paramMessage`Invalid permission expression: "${"expr"}"` },
    },
  },
  emitter: { options: optionsSchema },
});
```

Options schema:

| Option | Type | Values | Default |
|--------|------|--------|---------|
| `output-format` | string enum | `spicedb`, `metadata`, `unified-jsonschema` | `spicedb` |
| `strict` | boolean | `true` / `false` | `false` |

---

## Custom Decorators

Two decorators provide reliable discovery via compiler state sets:

### `@cascadePolicy`

Tags a model as a cascade-delete policy declaration. The `discoverDecoratedCascadePolicies()` function reads `StateKeys.cascadePolicy` to find all tagged models.

### `@annotation`

Tags a model as a resource annotation. The `discoverDecoratedAnnotations()` function reads `StateKeys.annotation` to find all tagged models.

Both are declared as `extern dec` in `lib/decorators.tsp` and implemented in `src/decorators.ts`.

---

## tspconfig.yaml Integration

```yaml
emit:
  - "@typespec/json-schema"
  - "typespec-as-schema"
options:
  "@typespec/json-schema":
    emitter-output-dir: "{output-dir}/json-schema"
  "typespec-as-schema":
    output-format: spicedb
```

A single `tsp compile` invocation runs both emitters, producing JSON Schema fragments and the selected Kessel output format.

---

## Module Reuse from CLI Era

| Module | Status | Notes |
|--------|--------|-------|
| `types.ts` | Unchanged | Core data types |
| `utils.ts` | Unchanged | Pure helpers |
| `primitives.ts` | Unchanged | Graph mutation builders |
| `discover-resources.ts` | Unchanged | Resource graph extraction |
| `expand-cascade.ts` | Unchanged | Cascade-delete expansion |
| `safety.ts` | Unchanged | Permission expression validation |
| `generate.ts` | Unchanged | Output generators (SpiceDB, metadata, JSON Schema) |
| `providers/rbac/rbac-provider.ts` | Unchanged | RBAC expansion logic |
| `discover-decorated.ts` | **New** | Replaces template-walking discovery with decorator state sets |
| `decorators.ts` | **New** | Decorator implementations |
| `emitter.ts` | **Replaced** `pipeline.ts` | `$onEmit` orchestrates the pipeline |
| `lib.ts` | **Adapted** | Added `$lib`, `StateKeys`, emitter options |
| `index.ts` | **New** | Package entry point |

Removed: `spicedb-emitter.ts` (CLI), `pipeline.ts` (standalone orchestrator), `provider.ts` (ExtensionProvider interface), `registry.ts`, `discover-extensions.ts`, `discover-platform.ts`.

---

## Design Decisions

### Why decorators over template walking

Template-based discovery relied on name matching (`model.name === "CascadeDeletePolicy"`) which is fragile across namespaces and aliasing. Decorator state sets are compiler-guaranteed: if `@cascadePolicy` is on a model, it appears in the state set regardless of how it was instantiated.

### Why a single provider (RBAC) is called directly

The `ExtensionProvider` interface was removed because there is currently only one provider (RBAC). The emitter calls `discoverV1Permissions`, `expandV1Permissions`, and `wireDeleteScaffold` directly. If additional providers are needed, a provider registry can be reintroduced.

### Why three separate output formats instead of a bundled IR

The TypeSpec, Starlark, and CUE POCs all produce the same three standalone outputs directly. A bundled IR artifact added an extra layer unique to TypeSpec without providing value over running `tsp compile` three times or extending the emitter to produce multiple outputs per invocation.
