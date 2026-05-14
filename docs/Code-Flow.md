# Code Flow: TypeSpec Emitter Pipeline

This document traces the full code flow from `tsp compile` invocation through to file output, using diagrams to illustrate data movement and module responsibilities.

For deeper coverage of types, interfaces, and the DSL surface, see [Architecture-Guide.md](./Architecture-Guide.md).

---

## High-Level Pipeline

```mermaid
flowchart TD
    invoke["tsp compile schema/main.tsp"]
    compile["TypeSpec Compiler"]
    onEmit["$onEmit (emitter.ts)"]
    discover["Discovery"]
    preVal["Pre-Expansion Validation"]
    rbacExp["RBAC Expansion"]
    cascadeExp["Cascade-Delete Expansion"]
    postVal["Post-Expansion Validation"]
    emit["Output Generation"]

    invoke --> compile
    compile -->|"Program (AST + types + state sets)"| onEmit
    onEmit --> discover
    discover -->|"ResourceDef[], V1Extension[], CascadeDeleteEntry[], AnnotationEntry[]"| preVal
    preVal --> rbacExp
    rbacExp -->|"mutated ResourceDef[]"| cascadeExp
    cascadeExp -->|"final ResourceDef[]"| postVal
    postVal --> emit
```

---

## Phase 1: Compilation

The TypeSpec compiler resolves the import graph rooted at `schema/main.tsp`, parses all `.tsp` files into a typed `Program` (AST + resolved type graph), and runs decorator implementations that populate compiler state sets.

```mermaid
flowchart TD
    main["schema/main.tsp"]
    kesselExt["lib/kessel-extensions.tsp"]
    rbacExt["schema/rbac/rbac-extensions.tsp"]
    rbacTypes["schema/rbac/rbac.tsp"]
    hbi["schema/hbi.tsp"]
    remediations["schema/remediations.tsp"]
    kessel["lib/kessel.tsp"]
    decorators["lib/decorators.tsp"]
    jsonSchema["@typespec/json-schema"]

    main --> kesselExt
    main --> rbacExt
    main --> rbacTypes
    main --> hbi
    main --> remediations

    kesselExt --> kessel
    rbacExt --> kessel
    rbacTypes --> kessel
    hbi --> kessel
    hbi --> kesselExt
    hbi --> decorators
    hbi --> rbacExt
    hbi --> rbacTypes
    hbi --> jsonSchema
    remediations --> kessel
    remediations --> kesselExt
    remediations --> rbacExt
    remediations --> rbacTypes
```

**Outputs:** A `Program` object containing the resolved type graph and state sets populated by `@cascadePolicy` and `@annotation` decorators.

---

## Phase 2: Discovery

Four independent discovery paths extract structured data from the compiled `Program`:

```mermaid
flowchart LR
    program["Program"]

    subgraph resourceDiscovery [Resource Discovery]
        dr["discoverResources()"]
        drOut["ResourceDef[]"]
        dr --> drOut
    end

    subgraph rbacDiscovery [RBAC Permission Discovery]
        dp["discoverV1Permissions()"]
        dpOut["V1Extension[]"]
        dp --> dpOut
    end

    subgraph decoratorDiscovery [Decorator Discovery]
        dc["discoverDecoratedCascadePolicies()"]
        da["discoverDecoratedAnnotations()"]
        dcOut["CascadeDeleteEntry[]"]
        daOut["Map of AnnotationEntry[]"]
        dc --> dcOut
        da --> daOut
    end

    program --> dr
    program --> dp
    program --> dc
    program --> da
```

### Resource Discovery (`discover-resources.ts`)

Walks all models in the program via `navigateProgram`. For each model with `Assignable`, `BoolRelation`, or `Permission` properties, emits a `ResourceDef` with relations. Skips models in the `Kessel` namespace and extension template instances.

### RBAC Permission Discovery (`rbac-provider.ts`)

Finds the `V1WorkspacePermission` template model in namespace `Kessel`, then walks all models that are template instances of it. Also resolves top-level `alias` statements via `program.checker.getTypeForNode` to catch alias-based instantiations. Extracts `(application, resource, verb, v2Perm)` tuples.

### Decorator Discovery (`discover-decorated.ts`)

Reads `program.stateSet(StateKeys.cascadePolicy)` and `program.stateSet(StateKeys.annotation)` — populated by the `@cascadePolicy` and `@annotation` decorator implementations in `src/decorators.ts`. Extracts structured entries with de-duplication.

---

## Phase 3: Pre-Expansion Validation

```mermaid
flowchart LR
    resources["ResourceDef[]"]
    validate["validatePreExpansionExpressions()"]
    warnings["warnings[]"]

    resources --> validate
    validate --> warnings
```

Checks that every `ref` and `subref` in permission expressions resolves to a known local relation name **before** expansion mutates the graph. Failures produce warnings (not errors) since providers will add missing relations.

**File:** `src/safety.ts`

---

## Phase 4: RBAC Expansion

Two sequential operations mutate the resource graph:

```mermaid
flowchart TD
    resources["ResourceDef[]"]
    perms["V1Extension[]"]

    expand["expandV1Permissions()"]
    scaffold["wireDeleteScaffold()"]

    afterRbac["ResourceDef[] (RBAC expanded)"]
    afterScaffold["ResourceDef[] (delete scaffold wired)"]

    resources --> expand
    perms --> expand
    expand --> afterRbac
    afterRbac --> scaffold
    scaffold --> afterScaffold
```

### expandV1Permissions — 7 mutations per permission

For each `V1Extension { application, resource, verb, v2Perm }`:

```mermaid
flowchart TD
    subgraph role [Role mutations]
        bool1["bool: app_any_any"]
        bool2["bool: app_resource_any"]
        bool3["bool: app_any_verb"]
        bool4["bool: app_resource_verb"]
        perm["permission v2Perm = OR of all above + global wildcard"]
    end

    subgraph roleBinding [RoleBinding mutation]
        rbPerm["permission v2Perm = AND(subject, granted->v2Perm)"]
    end

    subgraph workspace [Workspace mutation]
        wsPerm["permission v2Perm = OR(binding->v2Perm, parent->v2Perm)"]
    end

    bool1 --> perm
    bool2 --> perm
    bool3 --> perm
    bool4 --> perm
```

Additionally, all read-verb permissions accumulate into a `view_metadata` permission on Workspace.

### wireDeleteScaffold

Adds `delete` permissions to Role, RoleBinding, and Workspace if not already present, creating the RBAC cascade-delete chain.

**File:** `src/providers/rbac/rbac-provider.ts`

---

## Phase 5: Cascade-Delete Expansion

```mermaid
flowchart LR
    scaffolded["ResourceDef[] (scaffolded)"]
    policies["CascadeDeleteEntry[]"]
    expand["expandCascadeDeletePolicies()"]
    result["ResourceDef[] (final)"]

    scaffolded --> expand
    policies --> expand
    expand --> result
```

For each `CascadeDeleteEntry`, finds the child resource and adds a `delete` permission as `subref(parentRelation_slot, "delete")`. Requires the RBAC delete scaffold to already exist on Role/RoleBinding/Workspace.

**File:** `src/expand-cascade.ts`

---

## Phase 6: Post-Expansion Validation

```mermaid
flowchart LR
    fullSchema["ResourceDef[] (final)"]
    validate["validatePermissionExpressions()"]
    decision{strict mode?}
    errors["compiler errors (halt)"]
    ok["continue to emit"]

    fullSchema --> validate
    validate --> decision
    decision -->|yes + failures| errors
    decision -->|no or clean| ok
```

Cross-type validation on the fully expanded graph. Verifies that `subref` targets actually expose the referenced sub-relation on the target type. In strict mode, failures become compiler errors.

**File:** `src/safety.ts`

---

## Phase 7: Output Generation

The `output-format` option selects which generator runs:

```mermaid
flowchart TD
    fullSchema["ResourceDef[] (final)"]
    format{"output-format"}

    spicedb["generateSpiceDB()"]
    metadata["generateMetadata()"]
    jsonschema["generateUnifiedJsonSchemas()"]

    spicedbFile["schema.zed"]
    metaFile["metadata.json"]
    jsonFile["unified-jsonschemas.json"]

    fullSchema --> format
    format -->|spicedb| spicedb --> spicedbFile
    format -->|metadata| metadata --> metaFile
    format -->|unified-jsonschema| jsonschema --> jsonFile
```

**File:** `src/generate.ts`

---

## Data Flow Summary

Key data structures and how they flow between modules:

```mermaid
flowchart TD
    subgraph types ["types.ts"]
        ResourceDef["ResourceDef"]
        RelationDef["RelationDef"]
        RelationBody["RelationBody"]
        CascadeDeleteEntry["CascadeDeleteEntry"]
        AnnotationEntry["AnnotationEntry"]
    end

    discoverRes["discover-resources.ts"] -->|produces| ResourceDef
    discoverDec["discover-decorated.ts"] -->|produces| CascadeDeleteEntry
    discoverDec -->|produces| AnnotationEntry

    rbacProvider["providers/rbac/rbac-provider.ts"] -->|reads + mutates| ResourceDef
    expandCascade["expand-cascade.ts"] -->|reads + mutates| ResourceDef
    safety["safety.ts"] -->|validates| ResourceDef

    generate["generate.ts"] -->|reads| ResourceDef

    ResourceDef -->|contains| RelationDef
    RelationDef -->|contains| RelationBody
```

---

## Module Dependency Graph

Import relationships between `src/` modules:

```mermaid
graph LR
    index["index.ts"]
    lib["lib.ts"]
    emitter["emitter.ts"]
    types["types.ts"]
    primitives["primitives.ts"]
    utils["utils.ts"]
    discoverRes["discover-resources.ts"]
    discoverDec["discover-decorated.ts"]
    expandCasc["expand-cascade.ts"]
    generate["generate.ts"]
    safety["safety.ts"]
    decorators["decorators.ts"]
    rbacProvider["providers/rbac/rbac-provider.ts"]

    index --> lib
    index --> emitter
    index --> decorators

    lib --> types
    lib --> utils
    lib --> primitives
    lib --> discoverRes
    lib --> expandCasc
    lib --> generate

    emitter --> lib
    emitter --> discoverRes
    emitter --> discoverDec
    emitter --> expandCasc
    emitter --> generate
    emitter --> safety
    emitter --> rbacProvider

    primitives --> types
    primitives --> utils
    utils --> types
    discoverRes --> types
    discoverRes --> utils
    discoverDec --> types
    discoverDec --> lib
    discoverDec --> utils
    expandCasc --> types
    expandCasc --> utils
    expandCasc --> primitives
    generate --> types
    generate --> utils
    generate --> rbacProvider
    safety --> types
    safety --> utils
    rbacProvider --> types
    rbacProvider --> primitives
    rbacProvider --> utils
```

---

## Invocation

```bash
# Build the TypeScript emitter
npx tsc -p tsconfig.build.json

# Run the pipeline (choose one output-format)
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=spicedb
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=metadata
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=unified-jsonschema
```

The `strict` flag promotes post-expansion validation failures to errors:

```bash
npx tsp compile schema/main.tsp --option typespec-as-schema.output-format=spicedb --option typespec-as-schema.strict=true
```
