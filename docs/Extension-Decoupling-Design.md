# Extension Decoupling Design: TypeSpec Emitter

**Status**: Prototype  
**Context**: [Schema-Unification-Key-Questions.md](Schema-Unification-Key-Questions.md) Q2/Q3  

## Problem

In the TypeSpec POC, `V1BasedPermission` in `rbac.tsp` is a marker model -- it carries four string parameters but no behavior. The actual expansion logic (what relations to add to `role`, `role_binding`, `workspace`) is hardcoded in `src/lib.ts` `buildSchemaFromTypeGraph()`. Adding a new extension pattern requires modifying TypeScript emitter code.

In CUE and KSL, extension definitions live at the schema layer and emitters are generic visitors with no extension awareness.

This document designs two solutions and compares them.

## Option A: Declarative Extension Templates in TypeSpec

### Architecture

```mermaid
flowchart LR
    subgraph tspLayer [TypeSpec Schema Layer]
        ExtDef["Extension template model\n(RBAC team writes)"]
        ExtUse["Extension invocation\n(HBI team writes)"]
    end

    subgraph emitterLayer [Generic Emitter]
        Discover["discoverExtensionTemplates"]
        Apply["applyDeclaredPatches"]
        RD["Enriched ResourceDef array"]
    end

    ExtDef --> Discover
    ExtUse --> Discover
    Discover --> Apply --> RD
    RD --> SpiceDB["generateSpiceDB"]
    RD --> JSONSchema["generateUnifiedJsonSchemas"]
```

### Design

Replace the hardcoded `buildSchemaFromTypeGraph` with a generic patch applicator that reads structured patch declarations from TypeSpec models.

The RBAC team defines an `ExtensionTemplate` model where patch rules are expressed as structured TypeSpec properties. Property names follow the `{target}_{patchType}` convention where `target` is the resource to patch and `patchType` determines how the patch is applied:

```typespec
model V1WorkspacePermission<App extends string, Res extends string, Verb extends string, V2 extends string> {
  application: App;
  resource: Res;
  verb: Verb;
  v2Perm: V2;

  // Per-instance patches: applied once per extension invocation
  role_boolRelations: "{app}_any_any,{app}_{res}_any,{app}_any_{verb},{app}_{res}_{verb}";
  role_permission: "{v2}=any_any_any | {app}_any_any | {app}_{res}_any | {app}_any_{verb} | {app}_{res}_{verb}";
  roleBinding_permission: "{v2}=subject & granted->{v2}";
  workspace_permission: "{v2}=binding->{v2} | parent->{v2}";
  workspace_public: "{v2}";

  // Cross-instance accumulation: collected across ALL invocations, then merged
  workspace_accumulate: "view_metadata=or({v2}),when={verb}==read,public=true";

  // JSON Schema: extension-generated fields flow through to schema output
  jsonSchema_addField: "{v2}_id=string:uuid,required=true";
}
```

#### Patch types

| Patch type | Syntax | Semantics |
|-----------|--------|-----------|
| `boolRelations` | comma-separated names | Add `BoolRelation<Principal>` entries (deduped) |
| `permission` | `name=body` | Add a computed permission (body uses `\|` for OR, `&` for AND, `->` for subreference) |
| `public` | comma-separated names | Mark listed permissions as public |
| `accumulate` | `name=op(ref),when=cond,public=bool` | Two-pass: collect `ref` across all instances where `cond` holds, merge with `op` |
| `addField` | `name=type:format,required=bool` | Add a field to JSON Schema output for service resources |

The `accumulate` type is the key generalization. Rather than hardcoding `view_metadata` logic in the emitter, the template declares: "collect `{v2}` from every instance where `{verb}==read`, OR them together into a relation called `view_metadata`, mark it public." The emitter's generic two-pass loop handles this with zero knowledge of what `view_metadata` is.

The `addField` type extends the pipeline to JSON Schema output. Extension-generated writable relations (like permission IDs) can be declared as JSON Schema fields in the template. The custom emitter applies them to all non-RBAC resource schemas alongside the relation-derived fields.

The emitter:
1. Discovers template instances via alias resolution in `program.sourceFiles`
2. Reads patch-rule properties, splitting on the `{target}_{patchType}` naming convention
3. **Pass 1**: Iterates all extension instances, applying per-instance patches and collecting accumulator contributions
4. **Pass 2**: Emits accumulated relations (merges refs with the declared operator)
5. Returns enriched `ResourceDef[]` + `JsonSchemaFieldRule[]` to downstream emitters

### Tradeoffs

**Strengths:**
- RBAC team owns the full extension definition in `.tsp` -- no emitter changes for new patterns or accumulation rules
- Cross-instance patterns (like `view_metadata`) are declared as data, not code
- Extension-generated fields flow through to JSON Schema via `jsonSchema_addField`
- IDE support for authoring (TypeSpec IntelliSense on the template model)
- Single language, single compilation step

**Weaknesses:**
- TypeSpec can't enforce patch semantics at compile time -- the patch DSL is convention
- String interpolation is emitter-side (TypeSpec string literal types don't support runtime interpolation)
- Extension expansion still lives in Node.js; Go consumers receive post-expansion output
- Does not solve Q1 (Go-native in-memory model)

---

## Option B: TypeSpec Frontend + KSL Extension Layer

### Architecture

```mermaid
flowchart TD
    subgraph tspFrontend [TypeSpec Frontend - Build Time]
        TSP[".tsp schemas"]
        TSP_C["tsp compile"]
        KSL_IR["KSL Intermediate JSON\n(per namespace)"]
        JSON_S["JSON Schema\n(@typespec/json-schema)"]
    end

    subgraph kslLayer [KSL Extension Layer - Go]
        KSL_F[".ksl extension files\n(RBAC team owns)"]
        KSL_Load["intermediate.Load"]
        SEM["semantic.Schema"]
        EXT["ApplyExtensions"]
        ENRICHED["Enriched semantic.Schema"]
    end

    subgraph outputs [Output Emitters - Go]
        ZED["SpiceDB Zed"]
        JS["JSON Schema\n(relation-derived fields)"]
        META["Service Metadata"]
    end

    TSP --> TSP_C --> KSL_IR
    TSP_C --> JSON_S
    KSL_IR --> KSL_Load
    KSL_F --> KSL_Load
    KSL_Load --> SEM --> EXT --> ENRICHED
    ENRICHED --> ZED
    ENRICHED --> JS
    ENRICHED --> META
```

### Design

New emitter mode `--ksl-ir` translates TypeSpec's `ResourceDef[]` into KSL's `intermediate.Namespace` JSON format. The Go side uses KSL's existing `Load` -> `ToSemantic` -> `ApplyExtensions` pipeline.

**Translation mapping:**

| TypeSpec concept | KSL IR equivalent |
|-----------------|-------------------|
| `ResourceDef.namespace` | `Namespace.name` |
| `ResourceDef.name` | `Type.name` |
| `RelationBody.kind: "assignable"` | `RelationBody.kind: "self"` + `types` array + `cardinality` |
| `RelationBody.kind: "bool"` | `RelationBody.kind: "self"` + `types[{all: true}]` + `cardinality: "All"` |
| `RelationBody.kind: "ref"` | `RelationBody.kind: "reference"` + `relation` |
| `RelationBody.kind: "subref"` | `RelationBody.kind: "nested_reference"` + `relation` + `sub_relation` |
| `RelationBody.kind: "or"` (n-ary) | Binary `union` tree (fold left) |
| `RelationBody.kind: "and"` (n-ary) | Binary `intersect` tree (fold left) |
| `V1Extension` alias | `ExtensionReference` on the relation |

**What stays in TypeSpec:** Data modeling, JSON Schema output, resource type declarations.  
**What moves to KSL:** Extension definitions, extension expansion, SpiceDB generation.

### Tradeoffs

**Strengths:**
- Full decoupling: RBAC team writes extensions in KSL, HBI team writes data models in TypeSpec
- Extensions patch the Go semantic model; all Go-side emitters see the enriched model
- Solves Q3: extension-generated writable relations appear in JSON Schema
- Go-native model at runtime (no Node.js dependency after build)
- Leverages existing tested code on both sides

**Weaknesses:**
- Two languages (TypeSpec for data, KSL for authorization extensions)
- Build pipeline requires both Node.js and Go
- Data fields from TypeSpec need a separate reconciliation path to reach KSL's `Field` system

---

## Recommendation

Start with **Option B**. It solves all three original questions (Go-native model, extension decoupling, JSON Schema reflection) without inventing new abstractions. Both sides already have working code -- the work is primarily a translation layer.

Build **Option A** as a comparison point to show what pure-TypeSpec looks like.

## Comparison

Both POCs are implemented and tested. All 145 tests pass (88 original + 12 KSL IR unit + 9 KSL IR integration + 27 declarative equivalence + 9 parser unit tests).

### Quantitative Metrics

| Metric | Current (hardcoded) | Option A (declarative) | Option B (KSL IR bridge) |
|--------|-------------------|----------------------|------------------------|
| Extension definition | `buildSchemaFromTypeGraph` in `src/lib.ts` (102 LOC, TypeScript) | `lib/kessel-extensions.tsp` (52 LOC, TypeSpec) | `samples/rbac.ksl` (existing, KSL) |
| Generic infrastructure | N/A (hardcoded) | `src/declarative-extensions.ts` (240 LOC, written once) | `src/ksl-ir-emitter.ts` (262 LOC, written once) |
| Files changed for new extension pattern | `src/lib.ts` (emitter code) | `lib/kessel-extensions.tsp` (TypeSpec only) | `.ksl` file (KSL only) |
| Extension owner touches emitter? | Yes | No | No |
| Language for extensions | TypeScript | TypeSpec string-literal DSL | KSL |
| Runtime dependency | Node.js | Node.js | Go (after build) |
| Go-native model at runtime | No | No | Yes |
| Extension-generated fields in JSON Schema | No (emitter-side only) | Yes (via `jsonSchema_addField`) | Yes (via KSL semantic model) |

### Qualitative Comparison

**What each approach moves to the schema layer:**

| Concern | Current | Option A | Option B |
|---------|---------|----------|----------|
| Extension definition (what patches to apply) | Emitter TypeScript | TypeSpec template model | KSL extension definition |
| Extension invocation (which service applies it) | TypeSpec alias | TypeSpec alias (same) | TypeSpec alias → KSL IR reference |
| Extension expansion (interpreting patches) | Hardcoded in emitter | Generic emitter parser | KSL `ApplyExtensions()` in Go |
| Output emission (SpiceDB, JSON Schema) | Same emitter | Same emitter | KSL Go emitters |

**Adding a new extension pattern (e.g. `add_custom_role_hierarchy`):**

- **Current**: Write new TypeScript expansion logic in `buildSchemaFromTypeGraph`. Requires emitter expertise.
- **Option A**: Define a new TypeSpec template model with patch-rule properties. The generic `applyDeclaredPatches()` reads and applies them without code changes. Requires understanding the patch-rule DSL convention.
- **Option B**: Define a new `.ksl` extension file. KSL's existing `ApplyExtensions()` handles it. Requires KSL expertise.

### Key Differences

1. **Q1 (Go-native model)**: Only Option B provides a Go-native in-memory model. Option A still requires Node.js at runtime.

2. **Q3 (JSON Schema reflection)**: Both options now support extension-generated fields in JSON Schema, via different mechanisms. Option A uses `jsonSchema_addField` patches declared in the TypeSpec template; the custom JSON Schema emitter reads these from the enriched model. Option B uses KSL's semantic model where all Go-side emitters (including JSON Schema) see extension-created relations. The difference: Option A declares fields explicitly in the template; Option B derives them automatically from the semantic model.

3. **Accumulation patterns**: Both handle cross-instance patterns like `view_metadata`. Option A uses the generic `accumulate` patch type (`view_metadata=or({v2}),when={verb}==read`); CUE uses unification + comprehension; KSL uses `extension.Apply()`. Option A's approach is the most explicit (you can read the rule and know exactly what it does) but least validated at compile time.

4. **Single-language simplicity**: Option A keeps everything in TypeSpec + TypeScript. Option B requires two languages (TypeSpec for data models, KSL for authorization).

5. **Compile-time safety**: Option A's patch rules are string-literal conventions -- the TypeSpec compiler can't validate them. Option B's `.ksl` files are parsed and validated by the KSL compiler.

### Recommendation (updated)

**Option B** remains the stronger solution when a Go-native runtime model is required. It provides automatic JSON Schema reflection (fields derived from the semantic model, not manually declared) and leverages validated KSL extension definitions.

**Option A** is now a viable alternative for teams that prioritize single-language simplicity and are willing to use a custom JSON Schema emitter. With the generalized `accumulate` and `jsonSchema_addField` patch types, the RBAC team can define new extension patterns, accumulation rules, and JSON Schema side-effects entirely in TypeSpec -- zero emitter changes required. The tradeoff is that JSON Schema fields must be declared explicitly in the template rather than derived automatically.
