package models

import "time"

type Fault struct {
	Code, Message string
}
type TaskInput struct {
	Title              string     `json:"title"`
	Description        string     `json:"description"`
	GroupID            *string    `json:"groupId"`
	Priority           string     `json:"priority"`
	ScheduledDate      *string    `json:"scheduledDate"`
	StartTime          *string    `json:"startTime"`
	EndTime            *string    `json:"endTime"`
	Deadline           *time.Time `json:"deadline"`
	FocusMinutes       *int       `json:"focusMinutes"`
	EstimatedPomodoros *int       `json:"estimatedPomodoros"`
}
type Task struct {
	TaskInput
	CompletedAt            *time.Time `json:"completedAt"`
	DeletedAt              *time.Time `json:"deletedAt"`
	FocusProgress          float64    `json:"focusProgress"`
	ActualFocusSeconds     int64      `json:"actualFocusSeconds"`
	RecurrenceCadence      *string    `json:"recurrenceCadence"`
	RecurrenceIntervalDays *int       `json:"recurrenceIntervalDays"`
	ID                     string     `json:"id"`
	Status                 string     `json:"status"`
	Revision               int64      `json:"revision"`
	CreatedAt              time.Time  `json:"createdAt"`
	UpdatedAt              time.Time  `json:"updatedAt"`
	SeriesID               *string    `json:"seriesId"`
	OriginalOccurrenceDate *string    `json:"originalOccurrenceDate"`
}

func (e *Fault) Error() string { return e.Message }
