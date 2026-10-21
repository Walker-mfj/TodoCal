package localdate

import (
	"testing"
	"time"
)

func TestDSTGapAndEarlierOverlap(t *testing.T) {
	zone, e := time.LoadLocation("America/New_York")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = Instant("2030-03-10", "02:30:00", zone); e == nil {
		t.Fatal("accepted missing wall time")
	}
	got, e := Instant("2030-11-03", "01:30:00", zone)
	if e != nil {
		t.Fatal(e)
	}
	if got.UTC().Format(time.RFC3339) != "2030-11-03T05:30:00Z" {
		t.Fatal("did not select earlier overlap", got)
	}
}
func TestMidnightGapBoundary(t *testing.T) {
	zone, _ := time.LoadLocation("America/Sao_Paulo")
	if got := Boundary("2018-11-04", zone).UTC().Format(time.RFC3339); got != "2018-11-04T03:00:00Z" {
		t.Fatal("boundary skipped the wrong hour", got)
	}
}
