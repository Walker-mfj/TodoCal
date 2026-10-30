package models

type SettingsInput struct {
	Timezone          string `json:"timezone"`
	Appearance        string `json:"appearance"`
	FocusMinutes      int    `json:"focusMinutes"`
	ShortBreakMinutes int    `json:"shortBreakMinutes"`
	LongBreakMinutes  int    `json:"longBreakMinutes"`
	Sound             bool   `json:"sound"`
}
type Settings struct {
	SettingsInput
	Revision int64 `json:"revision"`
}
