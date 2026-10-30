package services

import (
	"testing"
	"time"
)

func TestComparisonPartialWeekAndShortMonth(t *testing.T) {
	now := time.Date(2030, 3, 31, 12, 30, 0, 0, time.UTC)
	r, e := Ranges("month", "2030-03-31", time.UTC, now)
	if e != nil {
		t.Fatal(e)
	}
	if r.From != "2030-03-01" || r.To != "2030-04-01" || r.PreviousFrom != "2030-02-01" || r.PreviousCutoff.Format(time.RFC3339) != "2030-03-01T00:00:00Z" {
		t.Fatal(r)
	}
	now = time.Date(2030, 10, 16, 12, 30, 0, 0, time.UTC)
	r, e = Ranges("week", "2030-10-16", time.UTC, now)
	if e != nil {
		t.Fatal(e)
	}
	if r.From != "2030-10-14" || r.PreviousCutoff.Format(time.RFC3339) != "2030-10-09T12:30:00Z" {
		t.Fatal(r)
	}
}
