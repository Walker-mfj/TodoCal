package focus

import (
	"testing"
	"time"
)

func TestElapsedPreservesFractionsCapsAndIgnoresNegativeClock(t *testing.T) {
	start := time.Date(2030, 10, 19, 0, 0, 0, 0, time.UTC)
	if got := ElapsedMicroseconds(500000, 1500, &start, start.Add(500*time.Millisecond)); got != 1000000 {
		t.Fatal(got)
	}
	if got := ElapsedMicroseconds(600000000, 1500, nil, start.Add(time.Hour)); got != 600000000 {
		t.Fatal(got)
	}
	if got := ElapsedMicroseconds(0, 1500, &start, start.Add(time.Hour)); got != 1500000000 {
		t.Fatal(got)
	}
	if got := ElapsedMicroseconds(500000, 1500, &start, start.Add(-time.Hour)); got != 500000 {
		t.Fatal(got)
	}
}
