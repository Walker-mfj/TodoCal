package models

import "time"

type Schedule struct {
	ScheduledDate    *string `json:"scheduledDate"`
	ScheduledEndDate *string `json:"scheduledEndDate"`
	StartTime        *string `json:"startTime"`
	EndTime          *string `json:"endTime"`
}
type UndoToken struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt"`
}
type Scheduled struct {
	Task      Task      `json:"task"`
	Undo      UndoToken `json:"undo"`
	ServerNow time.Time `json:"serverNow"`
}
