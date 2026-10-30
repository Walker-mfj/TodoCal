package services

import "focuscalendar/internal/models"

// CommandInput is supplied by the inbound adapter. Decoding is deferred until the
// service requests it, preserving receipt replay and ownership/revision precedence.
// Services receive typed domain inputs and never parse a request body.
type CommandInput interface {
	Task() (models.TaskInput, error)
	TaskPatch(models.TaskInput) (models.TaskPatch, error)
	Completion() (models.CompletionInput, error)
	RevisionCommand() (models.RevisionInput, error)
	Revision() (int64, error)
	Group() (models.GroupInput, error)
	GroupPatch(models.GroupInput) (models.GroupInput, error)
	SettingsPatch(models.SettingsInput) (models.SettingsInput, error)
	Series() (models.SeriesInput, error)
	Focus() (models.StartFocusInput, error)
	Schedule() (models.ScheduleInput, error)
	Empty() error
}
