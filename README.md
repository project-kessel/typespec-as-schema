# TypeSpec-as-Schema POC

Prototype exploring TypeSpec as a unified schema representation for Kessel, implementing the same RBAC + HBI benchmark scenario as the other POCs.

## Quick Start

```bash
npm install
tsp compile main.tsp          # Compile schemas, emit JSONSchema
npx tsx emitter/spicedb-emitter.ts  # Generate SpiceDB/Zed schema
```

## Architecture

```
TypeSpec Schema Files (.tsp)
    |
    v
TypeSpec Compiler
    |
    +---> JSONSchema (built-in @typespec/json-schema emitter)
    |         -> tsp-output/json-schema/HostData.yaml
    |
    +---> SpiceDB/Zed Schema (custom emitter)
              -> stdout (see emitter/spicedb-emitter.ts)
```

## File Structure

```
lib/kessel.tsp              # Core types: Cardinality, Assignable, Permission, BoolRelation
schemas/rbac.tsp             # RBAC: Principal, Role, RoleBinding, Workspace + extension template
schemas/hbi.tsp              # HBI: Host with data fields, permissions, extension calls
schemas/rbac-augment.tsp     # Alternative: RBAC using augment-based extensions
schemas/hbi-augment.tsp      # Alternative: HBI using model-is composition for extensions
main.tsp                     # Entrypoint
emitter/spicedb-emitter.ts   # SpiceDB/Zed schema generator (POC emitter)
```

## Two Extension Approaches Explored

### Approach 1: Template Model (rbac.tsp + hbi.tsp)
Extensions defined as parameterized generic models (`V1BasedPermission<App, Resource, Verb, V2Perm>`). The custom emitter discovers instantiations (via `alias`) and expands the template.

**Pros**: Clean schema files, extension intent is clear
**Cons**: Expansion logic lives in the emitter, not in the schema

### Approach 2: Augment + Model-Is (rbac-augment.tsp + hbi-augment.tsp)
Extensions use `model ... is BaseModel { ...extra props... }` to compose extended versions of RBAC types with additional permissions.

**Pros**: Extension results are explicit in the schema
**Cons**: Produces new model types rather than modifying originals; more verbose; `augment` can only add decorators, not properties

## Benchmark Results

### Feature Completeness

| Feature | TypeSpec |
|---------|----------|
| Resource type definitions | Y |
| Visibility controls | Partial (via convention/decorators) |
| Zanzibar set operations (and/or/unless) | Y (as string expressions in Permission<>) |
| Cardinality constraints | Y (via enum + generics) |
| Data field definitions | Y (native TypeSpec types) |
| Data validation rules | Y (format, pattern, maxLength, etc.) |
| Type unions | Y (native `string \| SatelliteNumericId`) |
| Cooperative extensions | Partial (template models + emitter expansion) |
| Extension control (predefined points) | Partial (template enforces structure) |
| allow_duplicates / idempotent extensions | Y (emitter handles dedup) |
| Cross-namespace imports | Y (native `import`) |
| SpiceDB/Zed output | Y (custom emitter) |
| JSONSchema output | Y (built-in emitter, high quality) |
| Common vs service-specific distinction | N |
| Advanced dynamic permissions | Limited (string-based expressions) |

### Impressions

**Strengths**:
- Best-in-class JSONSchema output — native TypeSpec types with validation decorators produce high-quality JSONSchema with proper `format`, `pattern`, `anyOf`, `maxLength` support
- Excellent IDE support — VSCode extension with autocomplete, error detection, go-to-definition
- Strong type system catches errors at schema authoring time
- Clean, readable syntax for data fields
- Active ecosystem with Microsoft backing
- AI models (Claude, GPT) understand TypeSpec well

**Weaknesses**:
- **Cooperative templating is the main challenge** — TypeSpec doesn't have a native mechanism for one model to programmatically add properties to another model at compile time. The `augment` keyword can add decorators but not properties. Extensions must either:
  - Be expanded by a custom emitter (template approach) — logic moves out of the schema
  - Create new model types via `model-is` composition — doesn't modify originals
- **Zanzibar set operations not native** — must be encoded as string expressions in `Permission<"expr">` or as model metadata; the type system doesn't validate these
- **Node.js dependency** — TypeSpec compiler requires Node.js runtime
- **No imperative logic** — can't express the v1-based permission expansion as code in the schema itself (unlike TypeScript and Starlark)

**Key finding**: TypeSpec excels at the data validation side (JSONSchema) but struggles with the authorization/relationship side (SpiceDB). It's the inverse of KSL, which excels at authorization but lacks data fields. A hybrid approach using TypeSpec for data fields and another mechanism for authorization could be powerful.

## Outputs

### JSONSchema (HostData.yaml)
```yaml
$schema: https://json-schema.org/draft/2020-12/schema
type: object
properties:
  subscription_manager_id:
    type: string
    format: uuid
  satellite_id:
    anyOf:
      - type: string
      - $ref: "#/$defs/SatelliteNumericId"
  insights_id:
    type: string
    format: uuid
  ansible_host:
    type: string
    maxLength: 255
$defs:
  SatelliteNumericId:
    type: string
    pattern: ^\d{10}$
```

### SpiceDB/Zed Schema
```
definition rbac/principal {
}

definition rbac/role {
    relation all_all_all: rbac/principal:*
    relation inventory_all_all: rbac/principal:*
    relation inventory_hosts_all: rbac/principal:*
    relation inventory_all_read: rbac/principal:*
    relation inventory_hosts_read: rbac/principal:*
    relation inventory_all_write: rbac/principal:*
    relation inventory_hosts_write: rbac/principal:*

    permission inventory_host_view = all_all_all + inventory_all_all + ...
    permission inventory_host_update = all_all_all + inventory_all_all + ...
}

definition rbac/role_binding {
    relation subject: rbac/principal
    relation granted: rbac/role

    permission inventory_host_view = subject & granted->inventory_host_view
    permission inventory_host_update = subject & granted->inventory_host_update
}

definition rbac/workspace {
    relation parent: rbac/workspace
    relation user_grant: rbac/role_binding

    permission inventory_host_view = user_grant->inventory_host_view + parent->inventory_host_view
    permission inventory_host_update = user_grant->inventory_host_update + parent->inventory_host_update
}

definition inventory/host {
    relation workspace: rbac/workspace

    permission view = workspace->inventory_host_view
    permission update = workspace->inventory_host_update
}
```
