package schema

import (
	"testing"
)

func TestLoadEmbeddedRoundTrip(t *testing.T) {
	ir, err := LoadEmbedded()
	if err != nil {
		t.Fatalf("LoadEmbedded() failed: %v", err)
	}

	if ir.Version == "" {
		t.Error("expected non-empty version")
	}

	if len(ir.Resources) == 0 {
		t.Error("expected at least one resource")
	}

	if len(ir.Extensions) == 0 {
		t.Error("expected at least one provider key in extensions map")
	}
	for provider, exts := range ir.Extensions {
		if provider == "" {
			t.Error("expected non-empty provider key")
		}
		if len(exts) == 0 {
			t.Errorf("expected at least one extension for provider %q", provider)
		}
	}

	if len(ir.Metadata) == 0 {
		t.Error("expected at least one metadata entry")
	}

	if ir.SpiceDB == "" {
		t.Error("expected non-empty SpiceDB schema")
	}
}
