# Extension Decoupling Design: TypeSpec Emitter

**Status**: Prototype  
**Context**: [Schema-Unification-Key-Questions.md](../../../docs/analysis/Schema-Unification-Key-Questions.md) Q2/Q3  

## Problem

In the TypeSpec POC, `V1BasedPermission` / `V1WorkspacePermission` in [`schema/rbac.tsp`](../schema/rbac.tsp) (and [`lib/kessel-extensions.tsp`](../lib/kessel-extensions.tsp)) act as **marker** templates: they carry parameters but the **expansion** (what relations to add to `role`, `role_binding`, `workspace`) used to be hardcoded in `src/lib.ts` `buildSchemaFromTypeGraph()`. Adding a new extension pattern required editing TypeScript emitter code.

In sibling POCs such as **CUE**, extension definitions can live closer to the schema layer and emitters act as generic visitors. This POC instead **declares** patch rules in TypeSpec and applies them in a small generic interpreter under `src/`.

**Scope:** This document describes **only** the TypeSpec + Node pipeline implemented here. It does **not** integrate other schema languages or compilers; compare other `poc/*` trees separately in the schema-unify evaluation.

---

## Declarative extension templates (implemented)

### Architecture

```mermaid
flowchart LR
    subgraph tspLayer [TypeSpec schema layer]
        ExtDef["Extension template model\n(RBAC team writes)"]
        ExtUse["Extension invocation\n(HBI team writes)"]
    end

    subgraph emitterLayer [Generic emitter]
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

Replace imperative expansion with a **generic patch applicator** that reads structured patch declarations from TypeSpec models.

The RBAC team defines a template where patch rules use the `{target}_{patchType}` convention (`target` = resource to patch, `patchType` = how to patch):

```typespec
model V1WorkspacePermission<App extends string, Res extends string, Verb extends string, V2 extends string> {
  application: App;
  resource: Res;
  verb: Verb;
  v2Perm: V2;

  role_boolRelations: "{app}_any_any,{app}_{res}_any,{app}_any_{verb},{app}_{res}_{verb}";
  role_permission: "{v2}=any_any_any | {app}_any_any | {app}_{res}_any | {app}_any_{verb} | {app}_{res}_{verb}";
  roleBinding_permission: "{v2}=subject & granted->{v2}";
  workspace_permission: "{v2}=binding->{v2} | parent->{v2}";
  workspace_public: "{v2}";
  workspace_accumulate: "view_metadata=or({v2}),when={verb}==read,public=true";
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
| `addField` | `name=type:format,required=bool` | Add a field to JSON Schema output for service resources (scoped by extension) |

The emitter:

1. Discovers template instances via alias resolution in `program.sourceFiles`
2. Reads patch-rule properties, splitting on the `{target}_{patchType}` naming convention
3. **Pass 1**: Iterates all extension instances, applying per-instance patches and collecting accumulator contributions
4. **Pass 2**: Emits accumulated relations (merges refs with the declared operator)
5. Returns enriched `ResourceDef[]` + `JsonSchemaFieldRule[]` to downstream emitters

Implementation: [`src/declarative-extensions.ts`](../src/declarative-extensions.ts), [`src/pipeline.ts`](../src/pipeline.ts). `buildSchemaFromTypeGraph` in [`src/lib.ts`](../src/lib.ts) remains a **legacy** reference for regression tests against the declarative path.

### Tradeoffs

**Strengths**

- RBAC owns extension **rules** in `.tsp` — no emitter edits for new patterns expressible in the existing patch vocabulary
- Cross-instance patterns (e.g. `view_metadata`) are data, not one-off code
- Extension-driven JSON Schema fields via `jsonSchema_addField`
- IDE support on the template model

**Weaknesses**

- TypeSpec does not validate patch **string** semantics at compile time
- Interpolation is still evaluated in TypeScript
- Expansion runs in Node; Go consumers use emitted **`--ir`** JSON ([`go-consumer/schema/resources.json`](../go-consumer/schema/resources.json)), not an in-process TypeSpec compiler
- Does not by itself deliver a Go-native authoring/runtime model for the TypeSpec graph (that is a separate product choice)

---

## Comparison: imperative vs declarative (this POC)

Run `npx vitest run` in `poc/typespec-as-schema` for current test counts.

| Metric | Legacy (`buildSchemaFromTypeGraph`) | Declarative (`applyDeclaredPatches`) |
|--------|-------------------------------------|--------------------------------------|
| Where extension rules live | TypeScript in `src/lib.ts` | `lib/kessel-extensions.tsp` + service aliases in `schema/` |
| New pattern in same vocabulary | Edit TS | Edit `.tsp` template / patch strings |
| Generic applicator | N/A | `src/declarative-extensions.ts` |
| Go at runtime without Node | Via `--ir` embedded JSON (same for both paths after expansion) | Same |

---

## Recommendation

**Ship the declarative path** as the supported story for this POC: templates in `lib/`, invocations in `schema/`, applicator in `src/`, **`--ir`** for Go-friendly embedded JSON ([`go-consumer/schema/resources.json`](../go-consumer/schema/resources.json)). Keep legacy `buildSchemaFromTypeGraph` only until tests no longer need parity, then remove.

For **language-level** extension semantics and a **compiler-owned** graph, evaluate sibling POCs under `poc/` (including the standalone schema language prototype) separately from this TypeSpec emitter.
