package dto

import (
	"encoding/json"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"
	"time"
)

// Command retains the exact inbound payload. Controllers hash those same bytes;
// methods decode lazily so a replay is answered before payload interpretation.
type Command []byte

func decodeCommand[T any](raw []byte) (out T, err error) { err = parseInput(raw, &out); return }
func (c Command) Task() (models.TaskInput, error)        { return decodeCommand[models.TaskInput](c) }
func (c Command) Completion() (models.CompletionInput, error) {
	return decodeCommand[models.CompletionInput](c)
}
func (c Command) RevisionCommand() (models.RevisionInput, error) {
	return decodeCommand[models.RevisionInput](c)
}
func (c Command) Revision() (int64, error)            { return expected(c) }
func (c Command) Group() (models.GroupInput, error)   { return decodeCommand[models.GroupInput](c) }
func (c Command) Series() (models.SeriesInput, error) { return decodeCommand[models.SeriesInput](c) }
func (c Command) Focus() (models.StartFocusInput, error) {
	return decodeCommand[models.StartFocusInput](c)
}
func (c Command) Empty() error { _, err := decodeCommand[struct{}](c); return err }
func (c Command) GroupPatch(current models.GroupInput) (out models.GroupInput, err error) {
	err = mergePatch(c, current, &out)
	return
}
func (c Command) SettingsPatch(current models.SettingsInput) (out models.SettingsInput, err error) {
	err = mergePatch(c, current, &out)
	return
}
func (c Command) Schedule() (out models.ScheduleInput, err error) {
	out, err = decodeCommand[models.ScheduleInput](c)
	if err != nil {
		return
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(c, &fields); err != nil {
		return out, err
	}
	out.Present = map[string]bool{}
	for key := range fields {
		out.Present[key] = true
	}
	return
}
func (c Command) TaskPatch(current models.TaskInput) (out models.TaskPatch, err error) {
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(c, &fields); err != nil {
		return out, Invalid("Send a JSON object")
	}
	if v, ok := fields["scope"]; ok {
		if err = json.Unmarshal(v, &out.Scope); err != nil {
			return out, Invalid("Choose one, following, or all occurrences")
		}
	}
	if out.Scope != "" && out.Scope != "one" && out.Scope != "all" && out.Scope != "following" {
		return out, Invalid("Choose one, following, or all occurrences")
	}
	if v, ok := fields["expectedSeriesRevision"]; ok {
		if err = json.Unmarshal(v, &out.SeriesRevision); err != nil {
			return out, Invalid("Provide expectedSeriesRevision")
		}
	}
	for key, target := range map[string]**time.Time{"scheduledStartAt": &out.ScheduledStartAt, "scheduledEndAt": &out.ScheduledEndAt} {
		if raw, ok := fields[key]; ok {
			if err = json.Unmarshal(raw, target); err != nil {
				return out, Invalid("Use RFC3339 schedule instants")
			}
			delete(fields, key)
		}
	}
	delete(fields, "scope")
	delete(fields, "expectedSeriesRevision")
	recurrence, hasRecurrence := fields["recurrence"]
	if hasRecurrence {
		if out.Scope != "following" {
			return out, Invalid("Recurrence changes require following scope")
		}
		var rule models.RecurrenceRule
		if err = parseInput(recurrence, &rule); err != nil {
			return out, err
		}
		delete(fields, "recurrence")
	}
	patch, err := json.Marshal(fields)
	if err != nil {
		return out, err
	}
	err = mergePatch(patch, current, &out.Task)
	// Older clients move the date without sending a separate end date.
	if _, changed := fields["scheduledDate"]; changed {
		if _, explicit := fields["scheduledEndDate"]; !explicit && out.Task.ScheduledDate != nil && current.ScheduledDate != nil && current.ScheduledEndDate != nil {
			if _, e := localdate.Parse(*out.Task.ScheduledDate); e == nil {
				end := localdate.Add(*out.Task.ScheduledDate, localdate.Days(*current.ScheduledDate, *current.ScheduledEndDate))
				out.Task.ScheduledEndDate = &end
			}
		}
	}
	if hasRecurrence {
		fields["recurrence"] = recurrence
	}
	out.Fields = fields
	return
}
