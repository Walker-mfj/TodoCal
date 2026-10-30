package services

import (
	"testing"
	"time"
)

func TestHistoricalDateAllowed(t *testing.T) {
	date := "2020-01-01"
	in := TaskInput{Title: "Historical", ScheduledDate: &date}
	if err := Validate(&in, "UTC", time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC), nil); err != nil {
		t.Fatal(err)
	}
}
