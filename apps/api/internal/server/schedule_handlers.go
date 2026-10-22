package server

import (
	"encoding/json"
	"focuscalendar/internal/tasks"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

func (s *Server) scheduleTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in struct {
			tasks.Schedule
			ExpectedRevision int64 `json:"expectedRevision"`
		}
		if err := parseInput(raw, &in); err != nil {
			return nil, 0, err
		}
		var fields map[string]json.RawMessage
		json.Unmarshal(raw, &fields)
		for _, key := range []string{"scheduledDate", "startTime", "endTime"} {
			if _, ok := fields[key]; !ok {
				return nil, 0, tasks.Invalid("Provide " + key + " (null clears it)")
			}
		}
		if in.ExpectedRevision < 1 {
			return nil, 0, tasks.Invalid("Provide expectedRevision")
		}
		out, err := tasks.Reschedule(r.Context(), tx, p.ID, zone, r.PathValue("id"), now, in.Schedule, in.ExpectedRevision)
		return out, 200, err
	})
}
func (s *Server) undoSchedule(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in struct{}
		if err := parseInput(raw, &in); err != nil {
			return nil, 0, err
		}
		out, err := tasks.UndoSchedule(r.Context(), tx, p.ID, zone, r.PathValue("id"), now)
		return out, 200, err
	})
}
