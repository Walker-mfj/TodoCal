package dto

import (
	"bytes"
	"encoding/json"
	"errors"
	"focuscalendar/internal/models"
	"io"
)

func parseInput(raw []byte, v any) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return Invalid("Send a JSON object")
	}
	for key, value := range fields {
		if string(value) != "null" {
			continue
		}
		switch key {
		case "taskId", "endDate", "groupId", "scheduledDate", "scheduledEndDate", "startTime", "endTime", "deadline", "estimatedPomodoros", "focusMinutes", "completedAt":
		default:
			return Invalid("Field cannot be null: " + key)
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) == 0 || string(raw) == "null" {
		return Invalid("Send a JSON object")
	}
	if e := d.Decode(v); e != nil {
		return Invalid("Check the request fields")
	}
	if e := d.Decode(new(any)); !errors.Is(e, io.EOF) {
		return Invalid("Send one JSON object")
	}
	return nil
}
func expected(raw []byte) (int64, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return 0, Invalid("Send a JSON object")
	}
	var n int64
	if err := json.Unmarshal(fields["expectedRevision"], &n); err != nil || n < 1 {
		return 0, Invalid("Provide expectedRevision")
	}
	return n, nil
}
func mergePatch(raw []byte, current any, target any) error {
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(raw, &patch); err != nil {
		return Invalid("Send a JSON object")
	}
	delete(patch, "expectedRevision")
	old, _ := json.Marshal(current)
	var merged map[string]json.RawMessage
	if err := json.Unmarshal(old, &merged); err != nil {
		return err
	}
	for k, v := range patch {
		if _, ok := merged[k]; !ok {
			return Invalid("Unknown editable field: " + k)
		}
		merged[k] = v
	}
	combined, _ := json.Marshal(merged)
	return parseInput(combined, target)
}

func Invalid(message string) error { return &models.Fault{Code: "validation", Message: message} }
