# TypeSpec → Go Consumer (Embedded IR Example)

This demonstrates how a Go service consumes TypeSpec schemas **without requiring Node.js at runtime**.

## Architecture

```
 ┌─────────────────────────────────────────────────────────────────┐
 │                    Build Time (CI / Dev)                        │
 │                    Requires: Node.js + npm                      │
 │                                                                 │
 │  .tsp schemas ──► TypeSpec Compiler ──► Custom Emitter (--ir)   │
 │  (rbac.tsp,        (tsp compile)        (spicedb-emitter.ts)    │
 │   hbi.tsp, ...)                               │                 │
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
 │       ├──► .Extensions  (V1BasedPermission instances)           │
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
make compile      # validate .tsp + emit JSON Schema (tsp-output/)
make emit-ir      # write go-consumer/schema/resources.json
make go-build     # compile Go binary with embedded IR

# Run the standalone binary (no Node.js required)
make run

# Or run directly:
./go-consumer/bin/schema-consumer
```

## What's in resources.json?

The IR file is the complete output of a single TypeSpec compilation:

| Field         | Description                                       |
|---------------|---------------------------------------------------|
| `version`     | IR format version                                 |
| `generatedAt` | Timestamp of generation                           |
| `source`      | Source .tsp entry point                           |
| `resources`   | Full expanded type graph (after RBAC extension)   |
| `extensions`  | V1BasedPermission instances discovered            |
| `spicedb`     | Generated SpiceDB/Zed schema as a string          |
| `metadata`    | Per-service permission and resource lists          |
| `jsonSchemas` | Unified JSON schemas for data-bearing resources   |

## Go API

```go
package main

import "github.com/project-kessel/schema-unify/typespec-go-consumer/schema"

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

After modifying any `.tsp` schema file:

```bash
# npm script
npm run emit:ir

# or Make
make emit-ir

# or directly
npx tsx emitter/spicedb-emitter.ts main.tsp --ir go-consumer/schema/resources.json
```

Then rebuild the Go binary to pick up the changes:

```bash
make go-build
```
