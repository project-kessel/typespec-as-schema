# TypeSpec → Go Pipeline
#
# Build flow:
#   1. tsp compile   — validate .tsp schemas, emit JSON Schema
#   2. emit:ir       — walk type graph, write go-consumer/schema/resources.json
#   3. go build      — compile Go binary with resources.json embedded via //go:embed
#
# Node.js is required for steps 1-2 only. The resulting Go binary is standalone.

TSP       := npx tsp
TSX       := npx tsx
EMITTER   := emitter/spicedb-emitter.ts
MAIN_TSP  := main.tsp
IR_OUT    := go-consumer/schema/resources.json
GO_BIN    := go-consumer/bin/schema-consumer

.PHONY: all clean compile emit-ir emit-spicedb go-build run

all: compile emit-ir go-build

# Step 1: Validate TypeSpec schemas + emit JSON Schema via built-in emitter
compile:
	$(TSP) compile $(MAIN_TSP)

# Step 2: Generate the IR JSON from the TypeSpec type graph
emit-ir:
	$(TSX) $(EMITTER) $(MAIN_TSP) --ir $(IR_OUT)

# Step 3: Build the Go binary (embeds resources.json at compile time)
go-build:
	cd go-consumer && go build -o bin/schema-consumer .

# Run the compiled Go binary (no Node.js needed)
run: go-build
	./go-consumer/bin/schema-consumer

# Convenience: emit SpiceDB schema to stdout
emit-spicedb:
	$(TSX) $(EMITTER) $(MAIN_TSP)

# Convenience: emit service metadata to stdout
emit-metadata:
	$(TSX) $(EMITTER) $(MAIN_TSP) --metadata

clean:
	rm -f $(IR_OUT) $(GO_BIN)
	rm -rf tsp-output/
