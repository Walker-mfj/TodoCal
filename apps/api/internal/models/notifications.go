package models

type NotificationPreferences struct {
	TaskStart     bool   `json:"taskStart"`
	Deadline      bool   `json:"deadline"`
	FocusComplete bool   `json:"focusComplete"`
	BreakComplete bool   `json:"breakComplete"`
	LeadMinutes   int    `json:"leadMinutes"`
	QuietStart    string `json:"quietStart"`
	QuietEnd      string `json:"quietEnd"`
	Revision      int64  `json:"revision"`
}
type NotificationPreferencesInput struct {
	NotificationPreferences
	ExpectedRevision int64 `json:"expectedRevision"`
}
type PushInput struct {
	DeviceName string `json:"deviceName,omitempty"`
	Endpoint   string `json:"endpoint"`
	Keys       struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
}
