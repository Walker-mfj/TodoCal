package models

type Entry struct {
	Timezone   string  `json:"timezone,omitempty"`
	Live       bool    `json:"live,omitempty"`
	Task       Task    `json:"task"`
	GroupName  *string `json:"groupName"`
	GroupColor *string `json:"groupColor"`
}
type Day struct {
	Date       string   `json:"date"`
	Timezone   string   `json:"timezone"`
	Planned    int      `json:"planned"`
	Completed  int      `json:"completed"`
	Percentage *float64 `json:"percentage"`
	Finalized  bool     `json:"finalized"`
	Entries    []Entry  `json:"entries"`
}
