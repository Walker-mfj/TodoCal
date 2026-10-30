package models

import "time"

type FocusEntry struct {
	ID           string  `json:"id"`
	TaskTitle    *string `json:"taskTitle"`
	Status       string  `json:"status"`
	FocusSeconds float64 `json:"focusSeconds"`
	Pomodoros    int     `json:"pomodoros"`
}
type AnalyticsDay struct {
	Day
	FocusTimezone  string       `json:"focusTimezone"`
	CompletedTasks int          `json:"completedTasks"`
	CompletedIDs   []string     `json:"completedIds"`
	FocusSeconds   float64      `json:"focusSeconds"`
	Pomodoros      int          `json:"pomodoros"`
	FocusSessions  []FocusEntry `json:"focusSessions"`
}
type Metrics struct {
	Planned        int      `json:"planned"`
	Completed      int      `json:"completed"`
	Percentage     *float64 `json:"percentage"`
	CompletedTasks int      `json:"completedTasks"`
	FocusSeconds   float64  `json:"focusSeconds"`
	Pomodoros      int      `json:"pomodoros"`
	CompleteDays   int      `json:"completeDays"`
	PlannedDays    int      `json:"plannedDays"`
}
type Comparison struct {
	From                  string    `json:"from"`
	To                    string    `json:"to"`
	Through               time.Time `json:"through"`
	Metrics               Metrics   `json:"metrics"`
	PercentagePointChange *float64  `json:"percentagePointChange"`
	FocusSecondsChange    *float64  `json:"focusSecondsChange"`
}
type Report struct {
	Period     string         `json:"period"`
	From       string         `json:"from"`
	To         string         `json:"to"`
	Through    time.Time      `json:"through"`
	Timezone   string         `json:"timezone"`
	Metrics    Metrics        `json:"metrics"`
	Days       []AnalyticsDay `json:"days"`
	Comparison Comparison     `json:"comparison"`
}
