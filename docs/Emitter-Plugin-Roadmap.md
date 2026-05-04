# TypeSpec Emitter Plugin Roadmap

This document covers the path from the current standalone CLI pipeline to a registered TypeSpec emitter plugin (`$onEmit`), including what's required, what can be reused, and when to migrate.

---

## Current Architecture

The Kessel schema emitter is a **standalone TypeScript CLI** that uses the TypeSpec compiler as a library. It does not register as a TypeSpec emitter plugin and does not use custom decorators.

```
schema/*.tsp ──> compile() ──> Program ──> discover ──> provider expand ──> validate ──> generate
                 (library)      (AST)       (walk)      (primitives)        (safety)     (emit)
```

Key properties:

- **Single entry point**: `pipeline.ts` orchestrates the full compile-discover-expand-validate-generate flow in ~60 lines.
- **No plugin lifecycle**: No `$onEmit`, no `$onValidate`, no decorator state bags. The pipeline calls `compile(NodeHost, mainFile, { noEmit: true })` and walks the resulting `Program` object.
- **Testable without infrastructure**: Unit tests call pure functions on data structures. Integration tests call `compilePipeline()` directly. No `createTestRunner()` or in-memory file system needed.
- **Model templates as data carriers**: `V1WorkspacePermission`, `CascadeDeletePolicy`, and `ResourceAnnotation` are parameterized TypeSpec models that carry string parameters but have zero compile-time behavior.

This was chosen so the full pipeline is visible in one file and can be tested without TypeSpec plugin infrastructure.

---

## What a TypeSpec Emitter Plugin Requires

### 1. Package structure

An emitter plugin is an npm package that exports `$onEmit` and `$lib`. The current `package.json` already has `"tspMain": "lib/kessel-extensions.tsp"`, so the compiler knows this package provides TypeSpec types. The JS entry point needs to be added:

```json
{
  "exports": {
    ".": {
      "typespec": "./lib/kessel-extensions.tsp",
      "default": "./dist/index.js"
    }
  }
}
```

### 2. Library definition with emitter options

Create a `$lib` using `createTypeSpecLibrary` that defines the emitter's configuration schema:

```typescript
import { createTypeSpecLibrary, type JSONSchemaType } from "@typespec/compiler";

export interface KesselEmitterOptions {
  "output-format": "spicedb" | "ir" | "metadata" | "unified-jsonschema" | "annotations";
  "ir-output-path"?: string;
  "strict"?: boolean;
}

const optionsSchema: JSONSchemaType<KesselEmitterOptions> = {
  type: "object",
  properties: {
    "output-format": {
      type: "string",
      enum: ["spicedb", "ir", "metadata", "unified-jsonschema", "annotations"],
      nullable: true,
    },
    "ir-output-path": { type: "string", format: "absolute-path", nullable: true },
    "strict": { type: "boolean", nullable: true },
  },
  required: [],
  additionalProperties: false,
};

export const $lib = createTypeSpecLibrary({
  name: "kessel-emitter",
  diagnostics: {
    // Custom diagnostics would go here
  },
  emitter: { options: optionsSchema },
});
```

### 3. The `$onEmit` function

This replaces `spicedb-emitter.ts` as the entry point. The key difference: you receive an `EmitContext` with a `program` already compiled, instead of calling `compile()` yourself:

```typescript
import { type EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import type { KesselEmitterOptions } from "./lib.js";

export async function $onEmit(context: EmitContext<KesselEmitterOptions>) {
  if (context.program.compilerOptions.noEmit) return;

  // Existing pipeline stages work unchanged:
  const allTemplates = buildRegistry(providers);
  const { resources } = discoverResources(context.program, allTemplates);
  const annotations = discoverAnnotations(context.program);
  const cascadePolicies = discoverCascadeDeletePolicies(context.program);
  // Providers run their own discover() + expand() via ExtensionProvider

  // ... expand, validate, generate ...

  // Use emitFile instead of fs.writeFileSync
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "schema.zed"),
    content: spicedbOutput,
  });
}
```

### 4. tspconfig.yaml integration

Users add the emitter alongside the existing JSON Schema one:

```yaml
emit:
  - "@typespec/json-schema"
  - "typespec-as-schema"
options:
  "@typespec/json-schema":
    emitter-output-dir: "{output-dir}/json-schema"
  "typespec-as-schema":
    output-format: spicedb
    strict: true
```

Now `tsp compile` runs both emitters in one pass, solving the two-invocation consistency gap.

---

## Optional Custom Decorators

Going the plugin route gives access to decorator infrastructure. Two decorators would address the current architecture's known fragility points:

### `@kesselExtension` — reliable discovery

Currently, `discover-extensions.ts` identifies extension template instances through name-based matching (`isInstanceOf` falls back to comparing `model.name` and namespace strings). A decorator gives you a compiler-guaranteed state set:

```typescript
// Decorator implementation
export function $kesselExtension(context: DecoratorContext, target: Model) {
  context.program.stateSet(StateKeys.kesselExtension).add(target);
}

// Discovery becomes trivial
for (const model of program.stateSet(StateKeys.kesselExtension)) {
  // guaranteed to be a tagged model — no name matching needed
}
```

### `@permissionExpr` — compile-time expression validation

Currently, `Permission<"workspace.inventory_host_view">` passes a string literal through the type system. Validation only happens post-pipeline. A decorator could validate at compile time:

```typescript
export function $permissionExpr(context: DecoratorContext, target: ModelProperty, expr: string) {
  const parsed = parsePermissionExpr(expr);
  if (!parsed) {
    context.program.reportDiagnostic({
      code: "invalid-permission-expr",
      target,
      message: `Invalid permission expression: "${expr}"`,
    });
  }
}
```

This gives schema authors red squiggles in their IDE via the TypeSpec language server, instead of post-pipeline errors.

---

## Reuse Matrix

Most existing modules carry over unchanged. The pipeline architecture was designed with this separation in mind.

| Module | Reuse | Changes needed |
|--------|-------|----------------|
| `types.ts` | As-is | None |
| `utils.ts` | As-is | None |
| `parser.ts` | As-is | None |
| `registry.ts` | As-is | None |
| `primitives.ts` | As-is | Pure data transforms (graph mutations + cascade delete), no TypeSpec imports |
| `discover-extensions.ts` | Mostly | Could simplify if using decorator state sets instead of name matching |
| `discover-platform.ts` | As-is | Platform annotation/cascade discovery |
| `discover-resources.ts` | As-is | Resource graph extraction |
| `safety.ts` | As-is | Wire limits from emitter options instead of `PipelineOptions` |
| `generate.ts` | As-is | Use `emitFile()` instead of `fs.writeFileSync()` |
| `pipeline.ts` | Replace | `$onEmit` becomes the orchestrator; remove `compile()` call |
| `spicedb-emitter.ts` | Remove | CLI replaced by `tsp compile --emit` |
| `lib.ts` | Adapt | Add `$lib`, `$onEmit`, optional decorator exports |

**Lines of code impact**: ~80% of the codebase (`types.ts`, `utils.ts`, `parser.ts`, `registry.ts`, `primitives.ts`, `discover-*.ts`, `safety.ts`, `generate.ts`) is pure data transformation with no coupling to the CLI entry point. The main work is writing the `$lib` + `$onEmit` boilerplate (~50 lines) and adapting integration tests.

---

## Migration Triggers

The current standalone CLI architecture is the right choice today. Convert to a plugin when one of these triggers is hit:

| Trigger | Why it matters |
|---------|---------------|
| **Atomic multi-output** | Need `tsp compile` to produce SpiceDB + JSON Schema + IR in one pass with guaranteed consistency |
| **IDE diagnostics** | Want red squiggles for invalid permission expressions in VS Code via the TypeSpec language server |
| **npm distribution** | Other teams need to `npm install` the emitter and configure it via `tspconfig.yaml` |
| **Watch mode via compiler** | Need `tsp compile --watch` integration (though the CLI now has its own `--watch`) |
| **Decorator-based discovery** | Schema grows large enough that name-based discovery becomes unreliable |

---

## What You Lose

| Aspect | Current (CLI) | Plugin |
|--------|--------------|--------|
| **Pipeline visibility** | Single file (`pipeline.ts`) shows full flow | `$onEmit` replaces it — functionally the same, just triggered by compiler lifecycle |
| **CLI ergonomics** | `--preview <perm>`, `--metadata`, `--annotations` are CLI flags | Become emitter options: `--option kessel-emitter.output-format=metadata` |
| **Test simplicity** | `compilePipeline()` + pure function unit tests | Integration tests need `createTestRunner()` from `@typespec/compiler/testing` |
| **No plugin versioning** | Depend only on `@typespec/compiler` as a library | Must maintain plugin lifecycle compatibility across TypeSpec versions |

---

## Recommended Path

1. **Now**: Use the standalone CLI with the improvements from the current iteration (verb type narrowing, discovery stats, pre-expansion validation, unified compilation, watch mode).
2. **When a trigger hits**: Convert to a plugin. The conversion cost is modest — most code is already decoupled from the CLI entry point.
3. **Incremental step**: If only discovery reliability is a concern, add a single `@kesselExtension` decorator without going to a full plugin. This can be registered in the standalone CLI by importing it before calling `compile()`.
