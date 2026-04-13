# TypeSpec-as-Schema POC

Prototype exploring [TypeSpec](https://typespec.io/) as a unified schema representation for Kessel (same RBAC + HBI benchmark as sibling POCs).

**Layout (as planned — parity with `ts-as-schema`):**

| Folder | Role |
|--------|------|
| **`schema/`** | **Adopter + composition:** `main.tsp` entrypoint and service modules only (`rbac.tsp`, `hbi.tsp`, …). No platform vocabulary here. |
| **`lib/`** | **Platform vocabulary:** `kessel.tsp` (Assignable, Permission, …) and `kessel-extensions.tsp` (`V1WorkspacePermission` + patch rules). |
| **`src/`** | **Interpreter / tooling:** TypeScript that walks the TypeSpec program and emits SpiceDB, IR, metadata, unified JSON Schema. |
| **`samples/`** | Frozen **`demo-output.txt`** from `make samples` or `make demo` (review without running Node). |
| **`go-consumer/`** | Optional Go binary that embeds emitted IR (`//go:embed`). |
| **`test/`** | Vitest (imports from `src/`). |

**One-line map:** Authors extend **`schema/`** (and import **`lib/`** for Kessel types); all codegen lives in **`src/`**. Evaluators run **`make demo`** or **`make run`** (alias) for a console tour; **`make samples`** refreshes checked-in sample output.

## Quick Start

```bash
npm install
make demo              # or: make run — SpiceDB + metadata + JSON Schema fragment on stdout
make samples           # regenerate samples/demo-output.txt (same content as demo + file header)
# or stepwise:
npx tsp compile schema/main.tsp
npx tsx src/spicedb-emitter.ts schema/main.tsp
# Optional: npx tsx src/spicedb-emitter.ts schema/main.tsp --lenient-extensions
# (skip throwing on malformed declarative patch strings; default is strict)
```

## Architecture

```
lib/*.tsp  +  schema/*.tsp
    |
    v
TypeSpec Compiler (tsp compile schema/main.tsp)
    |
    +---> JSONSchema (built-in) → tsp-output/json-schema/
    |
    +---> src/spicedb-emitter.ts
              → stdout / --ir / --metadata / --unified-jsonschema
```

Services register permissions with **`Kessel.V1WorkspacePermission<...>`** (`lib/kessel-extensions.tsp`). **`applyDeclaredPatches`** lives in `src/declarative-extensions.ts`; **`expandSchemaWithExtensions`** in `src/pipeline.ts`. `buildSchemaFromTypeGraph` in `src/lib.ts` is a **legacy reference** for tests.

## Cross-links (evaluation)

- Jira [RHCLOUD-44305](https://redhat.atlassian.net/browse/RHCLOUD-44305); internal design docs for schema unification program (evaluation).
- Repo: `poc/typespec-as-schema/`.
- [docs/Extension-Decoupling-Design.md](docs/Extension-Decoupling-Design.md).

## Risks and tradeoffs

- **Node.js in CI** for `tsp` + `tsx`; Go consumer runtime needs no Node.
- **Emitter maintenance** — new extension *patch kinds* may require `src/` changes.
- **Patch DSL** — string rules are not fully validated by the TypeSpec checker.
- **Unified JSON Schema** — `jsonSchema_addField` is scoped by extension `application` (and optional `resource` slug vs model name). Omit `application` on hand-built `JsonSchemaExtraField` entries to apply everywhere (legacy). Use `--lenient-extensions` to skip throwing on malformed patch strings (default is strict).

## File structure

```
lib/
  kessel.tsp
  kessel-extensions.tsp
schema/
  main.tsp
  rbac.tsp
  hbi.tsp
  remediations.tsp
  policy.tsp
  rbac-augment.tsp
  hbi-augment.tsp
src/
  spicedb-emitter.ts
  lib.ts
  pipeline.ts
  declarative-extensions.ts
samples/
  README.md
  demo-output.txt
go-consumer/
test/
tspconfig.yaml
Makefile
```

## Benchmark highlights

| Feature | TypeSpec |
|---------|----------|
| Resource + relation modeling | Y |
| Zanzibar-style `Permission<"expr">` | Y |
| Data fields + JSON Schema | Y |
| Cooperative extensions | Y (declarative template + `src/` applicator) |
| SpiceDB / Zed | Y |

## Refresh `samples/demo-output.txt`

```bash
make samples
# equivalent:
make demo > samples/demo-output.txt 2>&1
```
# How to validate end-to-end 
From poc/typespec-as-schema/:

1. Install deps (once)
`npm install`

2. Full compile
`make compile`
Confirms schema/main.tsp + imports type-check and built-in JSON Schema emit runs.

3. Automated tests
`npx vitest run`
Covers declarative extensions, SpiceDB vs legacy expander, unified JSON Schema scoping, strict/lenient patches, etc.

4. Console tour (optional)
`make demo` or `make run`
SpiceDB snippet + metadata + unified JSON Schema fragment on stdout.

5. IR + Go path (no Node at runtime)

```
make emit-ir    # or: make all  # compile + IR + go-build
make go-build   # if you only ran emit-ir
./go-consumer/bin/schema-consumer
```
Confirms embedded IR loads and the Go binary prints resources/extensions.

6. Strict vs lenient (regression check)

* Default: npx tsx src/spicedb-emitter.ts schema/main.tsp should succeed on the benchmark schema.
* If you intentionally break a patch string in lib/kessel-extensions.tsp, default should throw; ... --lenient-extensions should not throw (may skip bad rules).
7. Optional: refresh checked-in samples
`make samples`
Regenerates samples/demo-output.txt for reviewers; diff if you care about golden output.