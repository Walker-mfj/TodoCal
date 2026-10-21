// Package localdate separates calendar-day arithmetic from elapsed durations.
package localdate

import (
	"fmt"
	"time"
)

func Parse(s string) (time.Time, error) {
	t, e := time.Parse("2006-01-02", s)
	if e != nil || t.Year() < 1 || t.Format("2006-01-02") != s {
		return t, fmt.Errorf("invalid local date")
	}
	return t, nil
}
func Add(s string, days int) string {
	t, _ := Parse(s)
	return t.AddDate(0, 0, days).Format("2006-01-02")
}
func Days(a, b string) int {
	x, _ := Parse(a)
	y, _ := Parse(b)
	return int((y.Unix() - x.Unix()) / 86400)
}

// Instant rejects gaps and selects the earlier occurrence when clocks overlap.
func Instant(date, clock string, loc *time.Location) (time.Time, error) {
	naive, e := time.Parse("2006-01-02 15:04:05", date+" "+clock)
	if e != nil {
		return time.Time{}, e
	}
	var best time.Time
	for _, hours := range []int{-48, -24, 0, 24, 48} {
		_, offset := naive.Add(time.Duration(hours) * time.Hour).In(loc).Zone()
		candidate := naive.Add(-time.Duration(offset) * time.Second)
		if candidate.In(loc).Format("2006-01-02 15:04:05") == date+" "+clock && (best.IsZero() || candidate.Before(best)) {
			best = candidate
		}
	}
	if best.IsZero() {
		return best, fmt.Errorf("local time does not exist")
	}
	return best, nil
}

// Boundary uses the first instant of a calendar date, including midnight transitions.
func Boundary(date string, loc *time.Location) time.Time {
	// Midnight may be missing. Find the first existing wall-clock minute;
	// a wholly skipped civil date ends at the start of the following date.
	for minute := 0; minute < 1440; minute++ {
		clock := fmt.Sprintf("%02d:%02d:00", minute/60, minute%60)
		if instant, err := Instant(date, clock, loc); err == nil {
			return instant
		}
	}
	return Boundary(Add(date, 1), loc)
}
