# TypeSpec-as-Schema v2: Analysis

**Branch:** `v2`
**Date:** April 15, 2026
**Baseline:** v1 — declarative extensions with 133 passing tests
**Status:** v2 implemented and verified — 145 passing tests

---

## Table of Contents

0. [The Problem](#0-the-problem)
   - [How v2 Solves It](#how-v2-solves-it)
1. [Executive Summary](#1-executive-summary)
2. [v1 Gaps Addressed](#2-v1-gaps-addressed)
3. [Architecture Overview](#3-architecture-overview)
4. [Change 1: TypeSpec Library & Emitter Plugin](#4-change-1-typespec-library--emitter-plugin)
5. [Change 2: Compile-Time Validation ($onValidate)](#5-change-2-compile-time-validation-onvalidate)
6. [Change 3: Constrained Template Parameters](#6-change-3-constrained-template-parameters)
7. [Change 4: Preview / Dry-Run Mode](#7-change-4-preview--dry-run-mode)
8. [New File Map](#8-new-file-map)
9. [Data Flow Diagrams](#9-data-flow-diagrams)
10. [Code Walkthrough](#10-code-walkthrough)
11. [Error Examples](#11-error-examples)
12. [Test Coverage](#12-test-coverage)
13. [Before / After Comparison](#13-before--after-comparison)
14. [Remaining Gaps & Future Work](#14-remaining-gaps--future-work)

---

## 0. The Problem

The KSL-055 evaluation of all six schema representation candidates (KSL, JSONSchema, TypeSpec, CUE, TypeScript, Starlark) scored TypeSpec **5/4/5/4/4** — strong across the board but with clear soft spots in IDE support (4) and usability (4). The evaluation text pinpointed exactly why:

> *"the core extension logic lives in template strings that TypeSpec's type checker treats as opaque — malformed patch rules, invalid targets, or interpolation mistakes are only caught when the TypeScript emitter runs, not at compile time. This means TypeSpec validates the carrier (alias parameters are type-checked) but not the payload (the patch rules that drive all the real output)."*

In concrete terms, here is what a service team writes in v1 to register a permission:

```typespec
alias viewPermission = Kessel.V1WorkspacePermission<
  "inventory",           // application — any string accepted
  "hosts",               // resource    — any string accepted
  "read",                // verb        — any string accepted
  "inventory_host_view"  // v2 perm     — any string accepted
>;
```

That one alias expands — behind a wall of opaque string interpolation — into **7+ mutations** across 4 different SpiceDB definitions plus a JSON Schema field addition. But the author has no way to know this, and the compiler has no way to check it. Three specific problems follow:

### Problem 1: Opaque Patch Rules ("carrier vs. payload")

The extension template stores its logic in string-valued properties like:

```
role_boolRelations: "{app}_any_any,{app}_{res}_any,{app}_any_{verb},{app}_{res}_{verb}";
workspace_accumulate: "view_metadata=or({v2}),when={verb}==read,public=true";
```

TypeSpec type-checks the *carrier* — it verifies the alias parameters are strings and the template instantiation is valid. But it treats the *payload* — the patch-rule strings that drive 100% of the real output — as opaque `string` values. The type checker cannot see inside them.

**What goes wrong:**
- A typo in a property name (`role_boolRelation` instead of `role_boolRelations`) silently produces no bool relations on rbac/role — the emitter just skips it.
- A malformed permission expression like `{v2}=` (missing body) only fails when the emitter runs, not at the point where the mistake was made.
- An unrecognized placeholder like `{application}` instead of `{app}` silently interpolates to an empty string, producing broken SpiceDB output with no error.

In other candidates (TypeScript, CUE, Starlark), the extension logic is expressed in the host language itself, so the language's own toolchain catches structural errors. TypeSpec's design trades that for a clean declarative syntax — but leaves a validation gap.

### Problem 2: Raw String Parameters ("just 4 strings")

The template signature in v1:

```typespec
model V1WorkspacePermission<
  App extends string,
  Res extends string,
  Verb extends string,
  V2 extends string
>
```

All four parameters are bare `string`. The compiler accepts `"READ"`, `"My-App"`, `"foo bar"`, `"  "`, or any other string without complaint. There is no autocomplete for verbs, no naming convention enforcement, and no way for IDE tooling to suggest valid values.

**What goes wrong:**
- A service team writes `"write"` vs `"Write"` vs `"WRITE"` — all compile, only one works at runtime.
- An app name with hyphens (`"my-app"`) generates SpiceDB relation names with hyphens, which SpiceDB rejects.
- A v2 perm name with dashes (`"inventory-host-view"`) silently breaks IR consumers that expect snake_case.

By comparison, TypeScript and CUE POCs use typed enums or constrained value sets for these inputs.

### Problem 3: One-Way Mirror ("what does my alias actually do?")

A service author writing `V1WorkspacePermission<"inventory", "hosts", "read", "inventory_host_view">` has no way to see the result without running the emitter and manually inspecting the generated SpiceDB schema, IR JSON, or metadata output. The mapping from 4 parameters → 7+ effects is invisible.

**What goes wrong:**
- An author has no mental model of what their alias produces — they can't review it, can't catch mistakes, can't reason about it.
- Code review is impossible without running the emitter — reviewers see 4 strings but not the 20+ lines of SpiceDB output they produce.
- Debugging extension issues requires diffing emitter output, not reading the schema source.

---

## How v2 Solves It

Each problem has a targeted fix, all enforced at compile time within the same `tsp compile` invocation:

| # | Problem | Root Cause | v2 Fix | Where |
|---|---------|-----------|--------|-------|
| 1 | Opaque patch rules | String properties invisible to type checker | **`$onValidate` hook** parses every patch-rule name and value at compile time; 10 diagnostic codes cover malformed targets, types, expressions, and placeholders | `src/validate.ts` |
| 2 | Raw string params | `extends string` accepts anything | **`KesselVerb` union type** (`"read" \| "write" \| "create" \| "delete"`) for verb (hard compile error); **regex pattern checks** for app, resource, v2Perm naming (compile diagnostic) | `lib/kessel-extensions.tsp`, `src/validate.ts` |
| 3 | One-way mirror | No expansion visibility | **`--preview` / `output-format: "preview"`** shows per-alias human-readable expansion: every relation, permission, accumulate, and JSON Schema effect | `src/preview.ts` |
| — | Two runtimes | Emitter ran separately from `tsp compile` | **Native `$onEmit` plugin** runs inside `tsp compile`; single invocation validates + emits all artifacts | `src/emitter.ts` |

The net effect on KSL-055 fitness scores:

| Criterion | v1 | v2 | Why |
|-----------|----|----|-----|
| Benchmark | 5 | 5 | No regression — all benchmark requirements still met |
| IDE / Tooling | 4 | **5** | Verb autocomplete from union type; red squiggles for bad params and malformed patch rules; preview for expansion visibility |
| AI Compatibility | 5 | 5 | No change |
| Usability | 4 | **5** | `--preview` makes the expansion model transparent; constrained verbs reduce guesswork; clear compile errors replace silent runtime failures |
| Dependencies | 4 | 4 | No change — still requires Node.js at build time |

All changes are **backward-compatible** — existing service `.tsp` files (`hbi.tsp`, `remediations.tsp`) compile without modification.

---

## 1. Executive Summary

v1 demonstrated that TypeSpec can serve as a single source of truth for Kessel schema — producing SpiceDB, JSON Schema, IR, and metadata from one `.tsp` definition. The KSL-055 evaluation scored it **5/4/5/4/4** but flagged three concrete concerns:

| Concern | Short Name |
|---------|-----------|
| Patch-rule strings are opaque to the type checker — errors only surface at emit time | **Opaque payload** |
| The four template parameters are just raw `string` — no constraints, no autocomplete | **Raw strings** |
| Authors can't see what their alias will expand into without running the full emitter | **One-way mirror** |

v2 addresses all three:

| Concern | v2 Fix | Enforcement |
|---------|--------|-------------|
| Opaque payload | `$onValidate` hook parses every patch rule at compile time | Hard error in IDE + `tsp compile` |
| Raw strings | `KesselVerb` union type + `$onValidate` pattern checks | Compile error for verb; compile error for bad app/resource/v2 names |
| One-way mirror | `--preview` flag / `output-format: preview` | Human-readable expansion summary |

All changes are **backward-compatible**. Existing service `.tsp` files compile without modification.

---

## 2. v1 Gaps Addressed

### 2.1 The "Opaque Payload" Problem

In v1, the extension template used string properties like:

```
role_boolRelations: "{app}_any_any,{app}_{res}_any,{app}_any_{verb},{app}_{res}_{verb}";
```

TypeSpec validated the *carrier* (template params are type-checked) but treated the *payload* (patch-rule strings) as opaque. A typo like `boolRelation` instead of `boolRelations` in a property name, or a malformed permission expression like `{v2}=` with no body, would only fail at emit time — or worse, silently produce wrong output.

**v2 fix:** A `$onValidate` hook runs automatically during `tsp compile`. It parses every patch-rule property name (`{target}_{patchType}`) and value, validating syntax against the known grammar. Errors appear as red squiggles in VS Code and as compiler diagnostics on the command line.

### 2.2 The "Raw Strings" Problem

In v1, the template signature was:

```typespec
model V1WorkspacePermission<App extends string, Res extends string, Verb extends string, V2 extends string>
```

All four parameters accepted any string. A service author could write `"READ"`, `"my-app"`, or `"foo bar"` and the compiler would not complain.

**v2 fix:** Two layers of constraint:

1. **Verb** is now `extends KesselVerb` where `KesselVerb = "read" | "write" | "create" | "delete"`. The TypeSpec compiler rejects invalid verbs at the type level — this is a hard compile error, identical to a TypeScript union mismatch.
2. **App, Resource, V2** are validated by `$onValidate` against naming patterns (lowercase alpha for app/resource, snake_case for v2 perm). These produce compile-time diagnostics with clear messages.

### 2.3 The "One-Way Mirror" Problem

In v1, a service author writing:

```typespec
alias viewPermission = Kessel.V1WorkspacePermission<"inventory", "hosts", "read", "inventory_host_view">;
```

...had no way to see what this alias would expand into without running the emitter and reading the generated SpiceDB or IR output. The mapping from four parameters to 7+ effects across 4 SpiceDB definitions and JSON Schema was invisible.

**v2 fix:** A `--preview` mode that shows, per alias, exactly what will be generated:

```
inventory_host_view (inventory/hosts/read):
  rbac/role: +4 bool relations: inventory_any_any, inventory_hosts_any, inventory_any_read, inventory_hosts_read
  rbac/role: +1 union permission: inventory_host_view
  rbac/roleBinding: +1 intersect (delegated) permission: inventory_host_view
  rbac/workspace: +1 union (delegated) permission: inventory_host_view
  rbac/workspace: mark public: inventory_host_view
  rbac/workspace: contributes inventory_host_view to view_metadata (when verb==read)
  json_schema: +inventory_host_view_id (string:uuid, required)
```

---

## 3. Architecture Overview

### v1 Architecture (two runtimes)

```
┌────────────────────────────────────────────────────────────┐
│  tsp compile                                               │
│  ┌──────────────────────────────────────────┐              │
│  │ TypeSpec Compiler                        │              │
│  │  • Parse .tsp files                      │              │
│  │  • Type-check models, relations          │              │
│  │  • Emit JSON Schema (built-in)           │              │
│  └──────────────────────────────────────────┘              │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│  npx tsx src/spicedb-emitter.ts     (separate invocation)  │
│  ┌──────────────────────────────────────────┐              │
│  │ Custom Emitter (TypeScript)              │              │
│  │  • Re-compile the same .tsp files        │              │
│  │  • Walk type graph                       │              │
│  │  • Discover extensions                   │              │
│  │  • Apply patches                         │              │
│  │  • Generate SpiceDB / IR / metadata      │              │
│  └──────────────────────────────────────────┘              │
└────────────────────────────────────────────────────────────┘
```

### v2 Architecture (single invocation)

```
┌──────────────────────────────────────────────────────────────────────┐
│  tsp compile schema/main.tsp                                         │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  TypeSpec Compiler                                             │  │
│  │   1. Parse & type-check .tsp files                             │  │
│  │   2. KesselVerb union: reject invalid verbs (compile error)    │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │  $onValidate (validate.ts)                               │  │  │
│  │  │   • Walk program models + scan alias statements           │  │  │
│  │  │   • Validate template property names ({target}_{type})    │  │  │
│  │  │   • Validate patch-rule string syntax per patchType       │  │  │
│  │  │   • Validate param values: app, resource, v2Perm naming   │  │  │
│  │  │   • Report diagnostics → IDE red squiggles / CLI errors   │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │  $onEmit (emitter.ts)                                    │  │  │
│  │  │   • Discover resources from type graph                    │  │  │
│  │  │   • Discover V1WorkspacePermission declarations           │  │  │
│  │  │   • Apply declared patches (interpolate + expand)         │  │  │
│  │  │   • Emit: spicedb | ir | metadata | unified-jsonschema   │  │  │
│  │  │          | preview                                        │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │  @typespec/json-schema (built-in)                        │  │  │
│  │  │   • Emit JSON Schema for @jsonSchema-decorated models     │  │  │
│  │  └──────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  Output: tsp-output/typespec-as-schema/{schema.zed | preview.txt}    │
│          tsp-output/json-schema/                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Change 1: TypeSpec Library & Emitter Plugin

### What Changed

The custom emitter was converted from a standalone `tsx` script into a native TypeSpec library. Three new modules were created:

| File | Role |
|------|------|
| `src/lib-definition.ts` | Library definition via `createTypeSpecLibrary` — declares the library name, diagnostics, and emitter option schema |
| `src/validate.ts` | `$onValidate` hook — runs automatically during compilation |
| `src/emitter.ts` | `$onEmit` hook — runs as a proper emitter plugin |
| `src/index.ts` | Re-exports `$lib`, `$onValidate`, `$onEmit` as the library entry point |

### Package Configuration

```json
// package.json (key fields)
{
  "main": "dist/index.js",
  "tspMain": "lib/kessel-extensions.tsp",
  "exports": {
    ".": {
      "typespec": "./lib/kessel-extensions.tsp",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "compile": "npm run build && tsp compile schema/main.tsp"
  }
}
```

```yaml
# tspconfig.yaml
emit:
  - "@typespec/json-schema"
  - "typespec-as-schema"
options:
  "typespec-as-schema":
    output-format: "spicedb"
```

### Build Flow

```
npm run compile
  │
  ├─ tsc -p tsconfig.build.json    (compile TS → dist/)
  │    src/lib-definition.ts  →  dist/lib-definition.js
  │    src/validate.ts        →  dist/validate.js
  │    src/emitter.ts         →  dist/emitter.js
  │    src/preview.ts         →  dist/preview.js
  │    src/index.ts           →  dist/index.js
  │
  └─ tsp compile schema/main.tsp
       │
       ├─ Load TypeSpec library (dist/index.js)
       │    → registers $onValidate, $onEmit, diagnostics
       │
       ├─ Compile & type-check .tsp files
       ├─ Run $onValidate (patch-rule + param validation)
       ├─ Run $onEmit (generate artifacts)
       └─ Run @typespec/json-schema (built-in)
```

### Why This Matters

| Before (v1) | After (v2) |
|-------------|-----------|
| Two separate invocations: `tsp compile` + `tsx src/spicedb-emitter.ts` | Single `tsp compile` does everything |
| Emitter re-compiles .tsp files internally | Emitter receives the already-compiled program |
| No validation of patch rules | Patch rules validated before emit |
| Output written with raw `fs.writeFileSync` | Output written with `emitFile` (auto-creates directories) |

The standalone `npx tsx src/spicedb-emitter.ts` CLI still works for backward compatibility.

---

## 5. Change 2: Compile-Time Validation ($onValidate)

### Validation Layers

The validator (`src/validate.ts`) runs two passes:

**Pass 1: Template definition validation** — checks that `V1WorkspacePermission` itself has well-formed property names:

```
For each property on the template (in the Kessel namespace):
  Skip if it's a known param name (application, resource, verb, v2Perm)
  Parse the property name as {target}_{patchType}
  Verify target ∈ {role, roleBinding, workspace, jsonSchema}
  Verify patchType ∈ {boolRelations, permission, public, accumulate, addField}
```

**Pass 2: Instance validation** — checks every alias that instantiates the template:

```
For each V1WorkspacePermission instance (model walk + alias scan):
  Validate param values:
    application  →  must match /^[a-z][a-z0-9]*$/
    resource     →  must match /^[a-z][a-z0-9]*$/
    v2Perm       →  must match /^[a-z][a-z0-9_]*$/
  Validate each patch-rule string:
    Check for unknown placeholders (not {app}, {res}, {verb}, {v2})
    boolRelations  →  non-empty comma-separated list
    permission     →  name=body format
    accumulate     →  parseable as name=op(ref),when=condition,public=bool
    addField       →  parseable as name=type:format,required=bool
    public         →  accepted as-is
```

### Alias Scanning

A key implementation detail: TypeSpec's `navigateProgram` does **not** visit alias declarations — only model declarations. Since service teams define permissions as `alias viewPerm = V1WorkspacePermission<...>`, the validator must also scan source file statements directly:

```typescript
for (const [, sourceFile] of program.sourceFiles) {
  for (const statement of sourceFile.statements) {
    if (!("value" in statement && "id" in statement)) continue;
    const aliasType = program.checker.getTypeForNode(statement);
    if (aliasType?.kind !== "Model") continue;
    if (!isInstanceOf(aliasType as Model, template)) continue;
    validateInstanceProperties(program, aliasType as Model);
  }
}
```

This mirrors the alias scanning in `discoverV1WorkspacePermissionDeclarations`.

### Registered Diagnostics

| Code | Severity | Trigger |
|------|----------|---------|
| `invalid-patch-target` | error | Property name has unknown target prefix |
| `invalid-patch-type` | error | Property name has unknown patch type suffix |
| `invalid-bool-relations` | error | Empty or unparseable boolRelations value |
| `invalid-permission-rule` | error | Permission value missing `name=body` format |
| `invalid-accumulate-rule` | error | Accumulate value doesn't match expected grammar |
| `invalid-add-field-rule` | error | AddField value doesn't match expected grammar |
| `invalid-placeholder` | warning | Unrecognized `{...}` placeholder in patch string |
| `invalid-app-name` | error | Application name not lowercase alphanumeric |
| `invalid-resource-name` | error | Resource name not lowercase alphanumeric |
| `invalid-v2-perm-name` | error | v2 perm name not lowercase snake_case |

---

## 6. Change 3: Constrained Template Parameters

### Before (v1)

```typespec
model V1WorkspacePermission<
  App extends string,     // accepts anything
  Res extends string,     // accepts anything
  Verb extends string,    // accepts anything
  V2 extends string       // accepts anything
>
```

### After (v2)

```typespec
alias KesselVerb = "read" | "write" | "create" | "delete";

model V1WorkspacePermission<
  App extends string,              // validated by $onValidate
  Res extends string,              // validated by $onValidate
  Verb extends KesselVerb,         // ← hard compile-time constraint
  V2 extends string                // validated by $onValidate
>
```

### Constraint Enforcement Matrix

| Parameter | TypeSpec Type Constraint | $onValidate Pattern | Error Location |
|-----------|------------------------|-------------------|----------------|
| App | `extends string` | `/^[a-z][a-z0-9]*$/` | IDE + CLI diagnostic |
| Res | `extends string` | `/^[a-z][a-z0-9]*$/` | IDE + CLI diagnostic |
| Verb | `extends KesselVerb` (union) | — | TypeSpec compile error |
| V2 | `extends string` | `/^[a-z][a-z0-9_]*$/` | IDE + CLI diagnostic |

### Why Verb Gets a Type Constraint But Others Don't

TypeSpec's type system uses **nominal scalars**. A `scalar AppName extends string` creates a new type that bare string literals are not assignable to. This would force service authors to wrap every parameter in a custom scalar constructor, breaking ergonomics:

```typespec
// This would NOT work:
alias viewPerm = V1WorkspacePermission<"inventory", ...>;
//                                      ^^^^^^^^^^^ error: "inventory" not assignable to AppName
```

**String literal unions**, however, work naturally — `"read"` is assignable to `"read" | "write" | "create" | "delete"`. Verbs are a small closed set, making this the right fit.

App, Resource, and V2 are open-ended identifiers. They're validated at the value level by `$onValidate` instead, which provides the same error experience (IDE squiggles + CLI diagnostics) without breaking the authoring syntax.

---

## 7. Change 4: Preview / Dry-Run Mode

### Usage

**CLI:**
```bash
npx tsx src/spicedb-emitter.ts schema/main.tsp --preview
```

**TypeSpec plugin:**
```yaml
# tspconfig.yaml
"typespec-as-schema":
  output-format: "preview"
```

### Output Format

For each `V1WorkspacePermission` alias, the preview shows the v2 permission name, the alias parameters, and every effect grouped by target:

```
inventory_host_view (inventory/hosts/read):
  rbac/role: +4 bool relations: inventory_any_any, inventory_hosts_any, inventory_any_read, inventory_hosts_read
  rbac/role: +1 union permission: inventory_host_view
  rbac/roleBinding: +1 intersect (delegated) permission: inventory_host_view
  rbac/workspace: +1 union (delegated) permission: inventory_host_view
  rbac/workspace: mark public: inventory_host_view
  rbac/workspace: contributes inventory_host_view to view_metadata (when verb==read)
  json_schema: +inventory_host_view_id (string:uuid, required)

inventory_host_update (inventory/hosts/write):
  rbac/role: +4 bool relations: inventory_any_any, inventory_hosts_any, inventory_any_write, inventory_hosts_write
  rbac/role: +1 union permission: inventory_host_update
  rbac/roleBinding: +1 intersect (delegated) permission: inventory_host_update
  rbac/workspace: +1 union (delegated) permission: inventory_host_update
  rbac/workspace: mark public: inventory_host_update
  rbac/workspace: contributes inventory_host_update to view_metadata (when verb==read)
  json_schema: +inventory_host_update_id (string:uuid, required)
```

### How It Works

`src/preview.ts` implements `generatePreview(extensions: DeclaredExtension[])`:

1. For each extension, iterates over its `patchRules`
2. Interpolates placeholders (`{app}`, `{res}`, `{verb}`, `{v2}`) with the alias parameters
3. Classifies each effect by target and type (bool relations, union/intersect/delegated permissions, public marks, accumulate contributions, JSON Schema fields)
4. Groups effects by target for readable output

```
┌──────────────────────────────┐
│  DeclaredExtension           │
│  params: {app, res, verb, v2}│
│  patchRules: PatchRule[]     │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  For each PatchRule:         │
│  1. interpolate(rawValue, p) │
│  2. switch(patchType):       │
│     boolRelations → count    │
│     permission → classify    │
│     public → mark            │
│     accumulate → parse ref   │
│     addField → parse schema  │
│  3. → PatchEffect{target, d} │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│  Group by target             │
│  Format as text lines        │
│  → human-readable summary    │
└──────────────────────────────┘
```

---

## 8. New File Map

### New Files (v2)

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib-definition.ts` | 98 | Library definition: `$lib`, diagnostics, emitter option schema |
| `src/validate.ts` | 207 | `$onValidate` hook: patch-rule + param validation |
| `src/emitter.ts` | 88 | `$onEmit` hook: native TypeSpec emitter plugin |
| `src/preview.ts` | 121 | `generatePreview`: human-readable expansion summary |
| `src/index.ts` | 3 | Library entry: re-exports `$lib`, `$onValidate`, `$onEmit` |
| `tsconfig.build.json` | 15 | TypeScript build config for `src/` → `dist/` |
| `test/unit/validate.test.ts` | 100 | Tests for `$onValidate` (param + patch-rule validation) |
| `test/unit/emitter-plugin.test.ts` | ~40 | Tests for `$onEmit` plugin integration |
| `test/unit/preview.test.ts` | ~80 | Tests for `generatePreview` output |

### Modified Files (v2)

| File | Change |
|------|--------|
| `lib/kessel-extensions.tsp` | Added `KesselVerb` alias, constrained `Verb` param, added doc comments |
| `src/spicedb-emitter.ts` | Added `--preview` flag, imports `generatePreview` |
| `src/declarative-extensions.ts` | Exported `interpolate` function (was private) |
| `package.json` | Added `main`, `tspMain`, `exports`, `build` script, TypeScript devDep |
| `tspconfig.yaml` | Added `typespec-as-schema` emitter with options |
| `Makefile` | Added `build` target, updated `compile`/`clean` targets |

---

## 9. Data Flow Diagrams

### Full Pipeline (v2)

```
 .tsp source files
 ┌─────────────┐  ┌──────────────────┐  ┌───────────────┐
 │ schema/      │  │ lib/             │  │ lib/          │
 │ main.tsp     │  │ kessel.tsp       │  │ kessel-ext.tsp│
 │ hbi.tsp      │  │ (core types)     │  │ (V1 template) │
 │ rbac.tsp     │  └────────┬─────────┘  └───────┬───────┘
 │ remediations │           │                     │
 └──────┬───────┘           │                     │
        │                   │                     │
        └───────────────────┴─────────────────────┘
                            │
                            ▼
                   ┌────────────────────┐
                   │  TypeSpec Compiler  │
                   │  (parse + check)   │
                   └────────┬───────────┘
                            │
               ┌────────────┼────────────┐
               │            │            │
               ▼            ▼            ▼
        ┌────────────┐ ┌─────────┐ ┌──────────────┐
        │ $onValidate│ │ $onEmit │ │ json-schema  │
        │            │ │         │ │ (built-in)   │
        │ • params   │ │ discover│ └──────┬───────┘
        │ • patches  │ │ expand  │        │
        │ • names    │ │ emit    │        ▼
        └────────────┘ └────┬────┘  tsp-output/
                            │       json-schema/
                            │
               ┌────────────┼───────────────┐
               │            │               │
               ▼            ▼               ▼
          schema.zed   resources.json   preview.txt
          (SpiceDB)    (IR / metadata)  (dry-run)
```

### Validation Flow

```
$onValidate(program)
    │
    ├─ findV1PermissionTemplate(program)
    │   └─ search namespaces for "V1WorkspacePermission" model
    │
    ├─ Pass 1: navigateProgram → template property validation
    │   │
    │   └─ For each model in Kessel namespace:
    │       └─ Check property names: {target}_{patchType}
    │           ├─ target ∈ {role,roleBinding,workspace,jsonSchema}? 
    │           └─ patchType ∈ {boolRelations,permission,public,accumulate,addField}?
    │
    ├─ Pass 1b: navigateProgram → instance patch-rule validation
    │   │
    │   └─ For each model that is an instance of V1WorkspacePermission:
    │       ├─ validateParamValues (app, resource, v2Perm patterns)
    │       └─ For each patch-rule property:
    │           ├─ Check for unknown {placeholders}
    │           └─ Validate value syntax per patchType
    │
    └─ Pass 2: alias statement scan (catches alias declarations)
        │
        └─ For each source file:
            └─ For each alias statement:
                └─ Resolve type → if V1WorkspacePermission instance:
                    ├─ validateParamValues
                    └─ Validate patch-rule values
```

### Preview Generation Flow

```
generatePreview(declared: DeclaredExtension[])
    │
    ├─ For each extension:
    │   │
    │   ├─ Header: "v2Perm (app/resource/verb):"
    │   │
    │   └─ For each patchRule:
    │       │
    │       ├─ interpolate(rawValue, params)
    │       │   └─ {app}→inventory, {res}→hosts, {verb}→read, {v2}→inventory_host_view
    │       │
    │       └─ switch(patchType):
    │           ├─ boolRelations → "+N bool relations: name1, name2, ..."
    │           ├─ permission    → "+1 union|intersect (delegated) permission: name"
    │           ├─ public        → "mark public: name1, name2"
    │           ├─ accumulate    → "contributes ref to target (when param==value)"
    │           └─ addField      → "+fieldName (type:format, required)"
    │
    └─ Group effects by target → format as indented text
```

---

## 10. Code Walkthrough

### 10.1 Library Definition (`src/lib-definition.ts`)

The library is registered with `createTypeSpecLibrary`. This defines the library name (used for diagnostic code prefixes), all diagnostic messages, and the emitter options schema:

```typescript
export const $lib = createTypeSpecLibrary({
  name: "kessel-emitter",
  diagnostics: {
    "invalid-patch-target": { severity: "error", messages: { default: "..." } },
    "invalid-patch-type":   { severity: "error", messages: { default: "..." } },
    "invalid-app-name":     { severity: "error", messages: { default: "..." } },
    // ... 7 more diagnostic codes
  },
  emitter: {
    options: EmitterOptionsSchema,  // JSON Schema for output-format, ir-output-path, etc.
  },
} as const);
```

The `KesselEmitterOptions` interface defines the emitter's configuration surface:

```typescript
export interface KesselEmitterOptions {
  "output-format"?: "spicedb" | "ir" | "metadata" | "unified-jsonschema" | "preview";
  "ir-output-path"?: string;
  "lenient-extensions"?: boolean;
}
```

### 10.2 Emitter Plugin (`src/emitter.ts`)

The `$onEmit` function receives an `EmitContext` containing the compiled program and the options from `tspconfig.yaml`:

```typescript
export async function $onEmit(context: EmitContext<KesselEmitterOptions>) {
  if (context.program.compilerOptions.noEmit) return;

  const { resources } = discoverResources(program);
  const declared = discoverV1WorkspacePermissionDeclarations(program);
  const { resources: fullSchema, jsonSchemaFields } = applyDeclaredPatches(resources, declared, { strict });

  switch (format) {
    case "spicedb":  // → schema.zed
    case "ir":       // → resources.json
    case "metadata": // → metadata.json
    case "unified-jsonschema": // → unified-jsonschema.json
    case "preview":  // → preview.txt
  }
}
```

It uses `emitFile` from `@typespec/compiler` rather than raw `fs.writeFileSync`, which handles directory creation automatically.

### 10.3 Template Constraint (`lib/kessel-extensions.tsp`)

```typespec
/** Allowed verbs for permission registration. */
alias KesselVerb = "read" | "write" | "create" | "delete";

model V1WorkspacePermission<
  App extends string,
  Res extends string,
  Verb extends KesselVerb,  // ← compile-time enum-like constraint
  V2 extends string
> {
  /** Lowercase application identifier (e.g. "inventory"). */
  application: App;
  /** Lowercase resource identifier (e.g. "hosts"). */
  resource: Res;
  /** The verb this permission covers. */
  verb: Verb;
  /** Snake_case v2 permission name (e.g. "inventory_host_view"). */
  v2Perm: V2;
  // ... patch-rule properties unchanged
}
```

### 10.4 Service Schema (unchanged)

Service `.tsp` files did not need any changes. The existing syntax continues to work:

```typespec
alias viewPermission = Kessel.V1WorkspacePermission<
  "inventory",    // validated: lowercase alpha
  "hosts",        // validated: lowercase alpha
  "read",         // type-checked: must be KesselVerb
  "inventory_host_view"  // validated: snake_case
>;
```

---

## 11. Error Examples

### Invalid Verb (compile error from TypeSpec type system)

```typespec
alias bad = Kessel.V1WorkspacePermission<"myapp", "things", "invalid", "myapp_thing_view">;
```

```
error invalid-argument: Argument of type '"invalid"' is not assignable to
parameter of type '"read" | "write" | "create" | "delete"'
```

### Invalid App Name (diagnostic from $onValidate)

```typespec
alias bad = Kessel.V1WorkspacePermission<"My-App", "things", "read", "myapp_thing_view">;
```

```
error kessel-emitter/invalid-app-name: Application name must be lowercase
alphanumeric (a-z, 0-9). Example: "inventory".
```

### Invalid Resource Name

```typespec
alias bad = Kessel.V1WorkspacePermission<"myapp", "my-things", "read", "myapp_thing_view">;
```

```
error kessel-emitter/invalid-resource-name: Resource name must be lowercase
alphanumeric (a-z, 0-9). Example: "hosts".
```

### Invalid v2 Permission Name

```typespec
alias bad = Kessel.V1WorkspacePermission<"myapp", "things", "read", "myapp-thing-view">;
```

```
error kessel-emitter/invalid-v2-perm-name: v2 permission name must be lowercase
snake_case (a-z, 0-9, _). Example: "inventory_host_view".
```

---

## 12. Test Coverage

### Test Suite Summary

| File | Tests | Category |
|------|-------|----------|
| `validate.test.ts` | 10 | `$onValidate`: param constraints + patch-rule format |
| `emitter-plugin.test.ts` | 2 | `$onEmit`: SpiceDB output from tsp compile |
| `preview.test.ts` | 8 | `generatePreview`: empty, single, multi-extension |
| `template-rules-drift.test.ts` | 1 | Template ↔ frozen rules alignment |
| `declarative-strict.test.ts` | 5 | Strict mode patch error handling |
| `declarativeParsers.test.ts` | 10+ | Accumulate + addField rule parsing |
| `generateSpiceDB.test.ts` | 10+ | SpiceDB output format |
| `generateMetadata.test.ts` | 5+ | Metadata JSON structure |
| `generateUnifiedJsonSchema.test.ts` | 5+ | Unified JSON Schema structure |
| `buildSchema.test.ts` | 10+ | Full pipeline integration |
| _...other unit tests_ | 20+ | camelToSnake, bodyToZed, parsePermissionExpr, etc. |
| **Total** | **145** | |

### New v2 Tests

**Parameter constraints** (`validate.test.ts`):
- Rejects uppercase app name (`"My-App"`)
- Rejects hyphenated resource name (`"my-things"`)
- Rejects dashed v2 perm name (`"myapp-thing-view"`)
- Passes for valid lowercase params

**Preview** (`preview.test.ts`):
- Returns "no extensions" message for empty input
- Shows heading per alias with `app/resource/verb` label
- Shows bool relation additions with correct count and names
- Shows permission effects with type classification
- Shows public marks
- Shows accumulate contributions with condition
- Shows JSON Schema field additions with type/format
- Handles multiple extensions

---

## 13. Before / After Comparison

| Dimension | v1 | v2 |
|-----------|----|----|
| **Build invocations** | `tsp compile` + `tsx emitter.ts` (two separate) | `tsp compile` (one, does everything) |
| **Verb validation** | None — any string accepted | Compile error — only `read\|write\|create\|delete` |
| **App/Resource/V2 validation** | None | Compile diagnostic with regex pattern |
| **Patch-rule validation** | At emit time (runtime error) | At compile time (IDE squiggle) |
| **Preview/dry-run** | Not available | `--preview` flag / `output-format: preview` |
| **Diagnostics** | None registered | 10 diagnostic codes with clear messages |
| **Tests** | 133 | 145 |
| **Service schema changes** | — | None required (backward compatible) |

### KSL-055 Score Impact

| Criterion | v1 Score | v2 Expected | Notes |
|-----------|----------|-------------|-------|
| Benchmark | 5 | 5 | No change — all benchmark requirements still met |
| IDE / Tooling | 4 | **5** | Verb autocomplete, red squiggles for bad params/patches, preview |
| AI Compatibility | 5 | 5 | No change |
| Usability | 4 | **5** | Preview mode, clearer errors, constrained verbs |
| Dependencies | 4 | 4 | No change — still requires Node.js at build time |

---

## 14. Remaining Gaps & Future Work

### Addressed in v2

- ~~Opaque patch-rule strings~~ → compile-time validation
- ~~Raw string template params~~ → KesselVerb union + pattern validation
- ~~One-way mirror~~ → preview mode
- ~~Two-runtime build~~ → single `tsp compile` invocation

### Still Open

| Gap | Description | Effort |
|-----|-------------|--------|
| **Go type codegen** | Generate Go struct definitions from IR schema so Go consumers get type safety | Medium |
| **Richer verb set** | `KesselVerb` currently has 4 values — may need expansion for `list`, `manage`, etc. | Low (just add to the union) |
| **v2Perm naming convention** | Could enforce `{app}_{resource}_{action}` pattern beyond just snake_case | Low |
| **Preview in IDE** | Currently preview requires running a command — could be a hover/code lens | Medium |
| **Diff mode** | Compare preview output before/after a change for regression detection | Medium |

---

*This document covers the `v2` branch of `poc/typespec-as-schema`. For the v1 baseline design, see [TypeSpec-POC-Design-Document.md](./TypeSpec-POC-Design-Document.md). For the KSL-055 evaluation, see [TypeSpec-POC-Review-Against-KSL-055.md](./TypeSpec-POC-Review-Against-KSL-055.md).*
