package main

import (
	"focuscalendar/internal/diagnostics"
	"testing"
)

func TestPoolDiagnosticsFlag(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		cfg, err := poolConfig("postgres://user:private@localhost/test", enabled)
		if err != nil {
			t.Fatal(err)
		}
		_, hasTracer := cfg.ConnConfig.Tracer.(diagnostics.PGTracer)
		if hasTracer != enabled {
			t.Fatal("diagnostic flag ignored")
		}
	}
}
