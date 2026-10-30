package models

import "time"

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
	ScheduleOffset int       `json:"-"`
	Offset         *int      `json:"-"`
	DeadlineTime   *string   `json:"-"`
}
