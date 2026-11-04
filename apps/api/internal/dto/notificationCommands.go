package dto

import (
	"encoding/json"
	"focuscalendar/internal/models"
	"focuscalendar/internal/services"
)

func (c Command) NotificationPreferences() (models.NotificationPreferencesInput, error) {
	return decodeCommand[models.NotificationPreferencesInput](c)
}
func (c Command) PushSubscription() (models.PushInput, error) {
	return decodeCommand[models.PushInput](c)
}

func (c Command) WorkspaceSettings() (services.CommandInput, services.CommandInput, error) {
	in, err := decodeCommand[struct {
		Settings      json.RawMessage `json:"settings"`
		Notifications json.RawMessage `json:"notifications"`
	}](c)
	if err != nil {
		return nil, nil, err
	}
	return Command(in.Settings), Command(in.Notifications), nil
}
