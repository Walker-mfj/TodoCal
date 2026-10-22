package server

import (
	"focuscalendar/internal/analytics"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/planning"
	"focuscalendar/internal/recurrence"
	"focuscalendar/internal/tasks"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

func (s *Server) createSeries(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in recurrence.Input
		if e := parseInput(raw, &in); e != nil {
			return nil, 0, e
		}
		out, e := recurrence.Create(r.Context(), tx, p.ID, zone, now, in)
		return out, 201, e
	})
}
func (s *Server) stopSeries(w http.ResponseWriter, r *http.Request) {
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
		out, e := recurrence.Stop(r.Context(), tx, p.ID, zone, r.PathValue("id"), now, in.ExpectedRevision)
		return out, 200, e
	})
}
func (s *Server) calendar(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if _, e := localdate.Parse(from); e != nil {
		fail(w, 422, "validation", "Use a valid from date")
		return
	}
	if _, e := localdate.Parse(to); e != nil {
		fail(w, 422, "validation", "Use a valid to date")
		return
	}
	if n := localdate.Days(from, to); n < 1 || n > 93 {
		fail(w, 422, "validation", "Calendar range must be 1–93 days, end-exclusive")
		return
	}
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time) (any, error) {
		if e := recurrence.Materialize(r.Context(), tx, p.ID, zone, from, to, now); e != nil {
			return nil, e
		}
		days := []planning.Day{}
		live := []tasks.Task{}
		for date := from; date < to; date = localdate.Add(date, 1) {
			day, e := planning.DayReport(r.Context(), tx, p.ID, zone, date, now)
			if e != nil {
				return nil, e
			}
			days = append(days, day)
			if !day.Finalized {
				for _, entry := range day.Entries {
					live = append(live, entry.Task)
				}
			}
		}
		rows, e := tx.Query(r.Context(), `SELECT series_id::text,original_occurrence_date::text,reason FROM recurrence_exceptions WHERE user_id=$1 AND original_occurrence_date>=$2::date AND original_occurrence_date<$3::date AND reason='invalid_local_time' ORDER BY original_occurrence_date,series_id`, p.ID, from, to)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		warnings := []map[string]string{}
		for rows.Next() {
			var id, date, reason string
			if e = rows.Scan(&id, &date, &reason); e != nil {
				return nil, e
			}
			warnings = append(warnings, map[string]string{"seriesId": id, "date": date, "reason": reason})
		}
		return map[string]any{"from": from, "to": to, "tasks": live, "days": days, "warnings": warnings}, rows.Err()
	})
}
func (s *Server) dayDetails(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	if _, e := localdate.Parse(date); e != nil {
		fail(w, 422, "validation", "Use a valid date")
		return
	}
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time) (any, error) {
		if e := recurrence.Materialize(r.Context(), tx, p.ID, zone, date, localdate.Add(date, 1), now); e != nil {
			return nil, e
		}
		return analytics.DayReport(r.Context(), tx, p.ID, zone, date, now)
	})
}

func (s *Server) getSeries(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time) (any, error) {
		return recurrence.Get(r.Context(), tx, p.ID, r.PathValue("id"))
	})
}
