package server

import (
	"focuscalendar/internal/focus"
	"focuscalendar/internal/tasks"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

func (s *Server) focusState(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time) (any, error) {
		return focus.Active(r.Context(), tx, p.ID, now)
	})
}
func (s *Server) startFocus(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in struct {
			DurationMinutes *int64  `json:"durationMinutes"`
			TaskID          *string `json:"taskId"`
			Kind            string  `json:"kind"`
		}
		if e := parseInput(raw, &in); e != nil {
			return nil, 0, e
		}
		var duration []int64
		if in.DurationMinutes != nil {
			duration = append(duration, *in.DurationMinutes)
		}
		out, e := focus.Start(r.Context(), tx, p.ID, in.TaskID, in.Kind, now, duration...)
		return out, 201, e
	})
}
func (s *Server) changeFocus(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in struct {
			ExpectedRevision int64 `json:"expectedRevision"`
		}
		if e := parseInput(raw, &in); e != nil {
			return nil, 0, e
		}
		if in.ExpectedRevision < 1 {
			return nil, 0, tasks.Invalid("Provide expectedRevision")
		}
		out, e := focus.Change(r.Context(), tx, p.ID, r.PathValue("id"), r.PathValue("action"), in.ExpectedRevision, now)
		return out, 200, e
	})
}
