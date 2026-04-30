# TypeSpec → Go Loader Example (Embedded IR)

This demonstrates how a Go service consumes TypeSpec schemas **without requiring Node.js at runtime**.

## Architecture

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                    Build Time (CI / Dev)                        │
 │                    Requires: Node.js + npm                      │
 │                                                                 │
 │  schema/*.tsp ──► TypeSpec Compiler ──► src/spicedb-emitter   │
 │                   (tsp compile)          (--ir)                 │
 │                                                ▼                │
 │                                        schema/resources.json    │
 └────────────────────────────────────────────────┬────────────────┘
                                                  │
                                                  │ //go:embed
                                                  ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                    Runtime (Go binary)                          │
 │                    Requires: nothing extra                      │
 │                                                                 │
 │  schema.LoadEmbedded() ──► IntermediateRepresentation           │
 │       │                                                         │
 │       ├──► .Resources   (full expanded type graph)              │
 │       ├──► .Extensions  (V1WorkspacePermission instances)       │
 │       ├──► .SpiceDB     (generated Zed schema string)           │
 │       ├──► .Metadata    (per-service permission/resource lists) │
 │       └──► .JSONSchemas (unified JSON schemas)                  │
 └─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# From the typespec-as-schema/ root:

# Full pipeline: compile schemas → emit IR → build Go binary
make all

# Or step by step:
make compile      # validate schema + emit JSON Schema (tsp-output/)
make emit-ir      # write go-loader-example/schema/resources.json
make go-build     # compile Go binary with embedded IR

# Run the standalone binary (no Node.js required)
make run-consumer

# Or run directly:
./go-loader-example/bin/schema-consumer
```

## What's in resources.json?

The IR file is the complete output of a single TypeSpec compilation:

| Field         | Description                                       |
|---------------|---------------------------------------------------|
| `version`     | IR format version                                 |
| `generatedAt` | Timestamp of generation                           |
| `source`      | Source .tsp entry point                           |
| `resources`   | Full expanded type graph (after RBAC extension)   |
| `extensions`  | Workspace permission extension params (from aliases) |
| `spicedb`     | Generated SpiceDB/Zed schema as a string          |
| `metadata`    | Per-service permission and resource lists          |
| `jsonSchemas` | Unified JSON schemas (ExactlyOne assignable `_id` fields)  |
| `annotations` | Optional key-value metadata per resource (feature flags, retention, etc.) |

## Go API

```go
package main

import "github.com/project-kessel/schema-unify/typespec-go-loader-example/schema"

func main() {
    // Option A: Load from the embedded binary (production)
    ir, err := schema.LoadEmbedded()

    // Option B: Load from a file path (development/testing)
    ir, err = schema.LoadFromFile("path/to/resources.json")

    // Use the IR
    for _, res := range ir.Resources {
        fmt.Printf("%s/%s has %d relations\n", res.Namespace, res.Name, len(res.Relations))
    }

    // Access the pre-generated SpiceDB schema
    fmt.Println(ir.SpiceDB)

    // Look up service metadata
    inv := ir.Metadata["inventory"]
    fmt.Println(inv.Permissions) // [inventory_host_view, inventory_host_update]
}
```

## Regenerating the IR

After modifying any `.tsp` under `schema/`:

```bash
npm run emit:ir
# or
make emit-ir
# or
npx tsx src/spicedb-emitter.ts schema/main.tsp --ir go-loader-example/schema/resources.json
```

Then rebuild the Go binary to pick up the changes:

```bash
make go-build
```

**Related:** Jira [RHCLOUD-44305](https://redhat.atlassian.net/browse/RHCLOUD-44305); internal schema-unification design docs (evaluation).
