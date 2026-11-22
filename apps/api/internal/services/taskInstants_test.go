package services

import (
	"encoding/json"
	"testing"
	"time"
)

func TestValidateOvernightSchedule(t *testing.T) {
	var in TaskInput
	if err := json.Unmarshal([]byte(`{"title":"Night work","scheduledDate":"2030-04-01","scheduledEndDate":"2030-04-02","startTime":"23:30","endTime":"01:00"}`), &in); err != nil {
		t.Fatal(err)
	}
	if err := Validate(&in, "Asia/Ho_Chi_Minh", time.Now(), nil); err != nil {
		t.Fatal(err)
	}
}

func TestTaskInstantsPreserveAcrossDateBoundary(t *testing.T) {
	date, endDate, start, end := "2030-04-02", "2030-04-02", "01:30", "03:00"
	in := TaskInput{Title: "Night", ScheduledDate: &date, ScheduledEndDate: &endDate, StartTime: &start, EndTime: &end}
	a, b, err := taskInstants(in, "Asia/Tokyo", nil)
	if err != nil {
		t.Fatal(err)
	}
	v := projectTask(Task{TaskInput: in, ScheduledStartAt: a, ScheduledEndAt: b}, "Asia/Ho_Chi_Minh")
	if *v.ScheduledDate != "2030-04-01" || *v.ScheduledEndDate != "2030-04-02" || *v.StartTime != "23:30" || *v.EndTime != "01:00" {
		t.Fatal(v)
	}
	edited := v.TaskInput
	edited.Title = "Changed title"
	aa, bb, err := taskInstants(edited, "Asia/Ho_Chi_Minh", &v)
	if err != nil || !aa.Equal(*a) || !bb.Equal(*b) || bb.Sub(*aa) != 90*time.Minute {
		t.Fatal(aa, bb, err)
	}
}

func TestTaskInstantsRejectInvalidEndsAndDSTGaps(t *testing.T) {
	for _, raw := range []string{
		`{"title":"Bad","scheduledDate":"2030-04-02","scheduledEndDate":"2030-04-01","startTime":"01:00","endTime":"23:00"}`,
		`{"title":"Bad","scheduledDate":"2030-04-02","scheduledEndDate":"2030-04-02","startTime":"01:00","endTime":"01:00"}`,
		`{"title":"Bad","scheduledDate":"2030-03-09","scheduledEndDate":"2030-03-10","startTime":"23:00","endTime":"02:30"}`,
	} {
		var in TaskInput
		if err := json.Unmarshal([]byte(raw), &in); err != nil {
			t.Fatal(err)
		}
		if err := Validate(&in, "America/New_York", time.Now(), nil); err == nil {
			t.Fatal("accepted invalid interval", raw)
		}
	}
}

func TestTaskInstantsDSTDurationAndFoldPreservation(t *testing.T) {
	var in TaskInput
	_ = json.Unmarshal([]byte(`{"title":"Spring night","scheduledDate":"2030-03-09","scheduledEndDate":"2030-03-10","startTime":"23:30","endTime":"03:30"}`), &in)
	a, b, err := taskInstants(in, "America/New_York", nil)
	if err != nil || b.Sub(*a) != 3*time.Hour {
		t.Fatal(a, b, err)
	}
	// A task created in UTC can project to the later 01:30 of a repeated hour.
	a1 := time.Date(2030, 11, 3, 6, 30, 0, 0, time.UTC)
	b1 := a1.Add(time.Hour)
	old := projectTask(Task{TaskInput: TaskInput{Title: "Fold"}, ScheduledStartAt: &a1, ScheduledEndAt: &b1}, "America/New_York")
	a, b, err = taskInstants(old.TaskInput, "America/New_York", &old)
	if err != nil || !a.Equal(a1) || !b.Equal(b1) {
		t.Fatal("content edit moved fold occurrence", a, b, err)
	}
}

func TestRecurringIntervalsAreBounded(t *testing.T) {
	start, end := "2030-01-01", "9000-01-01"
	if validateSeriesSpan(TaskInput{ScheduledDate: &start, ScheduledEndDate: &end}) == nil {
		t.Fatal("unbounded recurrence accepted")
	}
}

func TestSeriesDateShiftPreservesEndDayOffset(t *testing.T) {
	start, end, a, b := "2030-04-01", "2030-04-03", "23:30", "01:00"
	in := TaskInput{ScheduledDate: &start, ScheduledEndDate: &end, StartTime: &a, EndTime: &b}
	shiftScheduleDate(&in, "2030-05-01")
	if *in.ScheduledEndDate != "2030-05-03" {
		t.Fatal(in)
	}
}

func TestSeriesPartialEndEditCrossesOriginMidnight(t *testing.T) {
	date, endDate, a, b := "2030-01-01", "2030-01-01", "23:00", "23:30"
	original := TaskInput{Title: "Repeat", ScheduledDate: &date, ScheduledEndDate: &endDate, StartTime: &a, EndTime: &b}
	start, end, err := taskInstants(original, "UTC", nil)
	if err != nil {
		t.Fatal(err)
	}
	viewed := projectTask(Task{TaskInput: original, ScheduledStartAt: start, ScheduledEndAt: end}, "America/Los_Angeles")
	in := viewed.TaskInput
	newEnd := "16:30"
	in.EndTime = &newEnd
	converted, err := inputInZone(in, viewed, "America/Los_Angeles", "UTC")
	if err != nil {
		t.Fatal(err)
	}
	fields := seriesScheduleFields(map[string]json.RawMessage{"endTime": json.RawMessage(`"16:30"`)}, original, converted)
	template := applyFields(original, converted, fields)
	if template.ScheduledEndDate == nil || *template.ScheduledEndDate != "2030-01-02" || *template.EndTime != "00:30" {
		t.Fatal(template)
	}
	if err := Validate(&template, "UTC", time.Now(), nil); err != nil {
		t.Fatal(err)
	}
}
