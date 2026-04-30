package schema

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
)

//go:embed resources.json
var embeddedIR []byte

// LoadEmbedded returns the IR that was baked into the binary at compile time.
// The resources.json file must exist next to this .go file when `go build` runs.
func LoadEmbedded() (*IntermediateRepresentation, error) {
	return parse(embeddedIR)
}

// LoadFromFile reads the IR from an arbitrary path (useful for development/testing).
func LoadFromFile(path string) (*IntermediateRepresentation, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading IR file: %w", err)
	}
	return parse(data)
}

func parse(data []byte) (*IntermediateRepresentation, error) {
	var ir IntermediateRepresentation
	if err := json.Unmarshal(data, &ir); err != nil {
		return nil, fmt.Errorf("parsing IR JSON: %w", err)
	}
	return &ir, nil
}
