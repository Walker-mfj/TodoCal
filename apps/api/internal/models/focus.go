package models

import "time"

type FocusSession struct {
	ID             string     `json:"id"`
	TaskID         *string    `json:"taskId"`
	TaskTitle      *string    `json:"taskTitle"`
	Kind           string     `json:"kind"`
	Status         string     `json:"status"`
	TargetSeconds  int64      `json:"targetSeconds"`
	ElapsedSeconds int64      `json:"elapsedSeconds"`
	FocusSeconds   int64      `json:"focusSeconds"`
	Pomodoros      int        `json:"pomodoros"`
	StartedAt      time.Time  `json:"startedAt"`
	EndedAt        *time.Time `json:"endedAt"`
	RunningSince   *time.Time `json:"runningSince"`
	Revision       int64      `json:"revision"`
	Accumulated    int64      `json:"-"`
}
type FocusState struct {
	Active                 *FocusSession `json:"active"`
	Last                   *FocusSession `json:"last"`
	NextKind               string        `json:"nextKind"`
	CompletedFocusSessions int64         `json:"completedFocusSessions"`
	ServerNow              time.Time     `json:"serverNow"`
}
type TaskHistory struct {
	ActualFocusSeconds int64           `json:"actualFocusSeconds"`
	Sessions           []*FocusSession `json:"sessions"`
}
