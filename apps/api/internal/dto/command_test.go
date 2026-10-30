package dto

import (
	"errors"
	"focuscalendar/internal/models"
	"testing"
)

func TestCommandValidationPreservesNullableAndUnknownFields(t *testing.T) {
	for _, tc := range []struct {
		body string
		want string
	}{
		{`{"title":null}`, "Field cannot be null: title"},
		{`{"title":"x","unexpected":true}`, "Check the request fields"},
		{`[]`, "Send a JSON object"},
		{`null`, "Send a JSON object"},
	} {
		t.Run(tc.body, func(t *testing.T) {
			_, err := Command(tc.body).Task()
			var fault *models.Fault
			if !errors.As(err, &fault) || fault.Code != "validation" || fault.Message != tc.want {
				t.Fatalf("error: %v", err)
			}
		})
	}
	if _, err := Command(`{"title":"x","groupId":null}`).Task(); err != nil {
		t.Fatalf("nullable group: %v", err)
	}
}
func TestScheduleRetainsOmittedVersusExplicitNull(t *testing.T) {
	omitted, err := Command(`{"expectedRevision":1}`).Schedule()
	if err != nil {
		t.Fatal(err)
	}
	cleared, err := Command(`{"expectedRevision":1,"scheduledDate":null,"startTime":null,"endTime":null}`).Schedule()
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"scheduledDate", "startTime", "endTime"} {
		if omitted.Present[field] || !cleared.Present[field] {
			t.Fatalf("presence lost for %s", field)
		}
	}
}
func TestTaskPatchPreservesOmittedFieldsAndSeriesMetadata(t *testing.T) {
	group := "group"
	current := models.TaskInput{Title: "original", Description: "keep", GroupID: &group}
	cmd := Command(`{"expectedRevision":3,"scope":"all","expectedSeriesRevision":7,"title":"edited","groupId":null}`)
	revision, err := cmd.Revision()
	if err != nil || revision != 3 {
		t.Fatalf("revision: %d %v", revision, err)
	}
	patch, err := cmd.TaskPatch(current)
	if err != nil {
		t.Fatal(err)
	}
	if patch.Task.Title != "edited" || patch.Task.Description != "keep" || patch.Task.GroupID != nil || patch.Scope != "all" || patch.SeriesRevision != 7 {
		t.Fatalf("patch: %#v", patch)
	}
	if _, ok := patch.Fields["description"]; ok {
		t.Fatal("omitted field became present")
	}
	if _, ok := patch.Fields["groupId"]; !ok {
		t.Fatal("explicit null field lost")
	}
}
