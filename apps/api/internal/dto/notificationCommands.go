package dto

import "focuscalendar/internal/models"

func (c Command) NotificationPreferences() (models.NotificationPreferencesInput, error) {
	return decodeCommand[models.NotificationPreferencesInput](c)
}
func (c Command) PushSubscription() (models.PushInput, error) {
	return decodeCommand[models.PushInput](c)
}
