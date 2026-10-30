package models

import (
	"encoding/json"
	"time"
)

type RevisionInput struct {
	ExpectedRevision int64 `json:"expectedRevision"`
}
type CompletionInput struct {
	Complete         *bool      `json:"complete"`
	ExpectedRevision int64      `json:"expectedRevision"`
	CompletedAt      *time.Time `json:"completedAt"`
	MoveToToday      bool       `json:"moveToToday"`
}
type StartFocusInput struct {
	DurationMinutes *int64  `json:"durationMinutes"`
	TaskID          *string `json:"taskId"`
	Kind            string  `json:"kind"`
}
type ScheduleInput struct {
	Schedule
	ExpectedRevision int64           `json:"expectedRevision"`
	Present          map[string]bool `json:"-"`
}
type TaskPatch struct {
	Task           TaskInput
	Scope          string
	SeriesRevision int64
	Fields         map[string]json.RawMessage
}
