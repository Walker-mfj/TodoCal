package models

import "time"

type RecurrenceRule struct {
	Cadence      string  `json:"cadence"`
	IntervalDays int     `json:"intervalDays"`
	EndDate      *string `json:"endDate"`
}
type SeriesInput struct {
	Task         TaskInput `json:"task"`
	Cadence      string    `json:"cadence"`
	IntervalDays int       `json:"intervalDays"`
	EndDate      *string   `json:"endDate"`
}
type Series struct {
	SeriesInput
	ID             string    `json:"id"`
	Revision       int64     `json:"revision"`
	StoppedAfter   *string   `json:"stoppedAfter"`
	CreatedAt      time.Time `json:"createdAt"`
	OriginalCutoff *string   `json:"originalCutoff"`
	ScheduleOffset int       `json:"-"`
	Offset         *int      `json:"-"`
	DeadlineTime   *string   `json:"-"`
}
