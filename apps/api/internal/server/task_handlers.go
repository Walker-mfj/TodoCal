package server

import (
	"focuscalendar/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"time"
)

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in tasks.Input
		if e := parseInput(raw, &in); e != nil {
			return nil, 0, e
		}
		t, e := tasks.Create(r.Context(), tx, p.ID, zone, now, in)
		return t, 201, e
	})
}
func (s *Server) getTask(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string) (any, error) {
		return tasks.Get(r.Context(), tx, p.ID, r.PathValue("id"))
	})
}
func (s *Server) editTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		old, e := tasks.Get(r.Context(), tx, p.ID, r.PathValue("id"))
		if e != nil {
			return nil, 0, e
		}
		revision, e := expected(raw)
		if e != nil {
			return nil, 0, e
		}
		if revision != old.Revision {
			return nil, 0, tasks.Conflict()
		}
		var in tasks.Input
		if e = mergePatch(raw, old.Input, &in); e != nil {
			return nil, 0, e
		}
		t, e := tasks.Update(r.Context(), tx, p.ID, zone, now, old, in)
		return t, 200, e
	})
}
func (s *Server) completeTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in struct {
			Complete         *bool `json:"complete"`
			ExpectedRevision int64 `json:"expectedRevision"`
			MoveToToday      bool  `json:"moveToToday"`
		}
		if e := parseInput(raw, &in); e != nil {
			return nil, 0, e
		}
		if in.Complete == nil || in.ExpectedRevision < 1 {
			return nil, 0, tasks.Invalid("Provide complete and expectedRevision")
		}
		old, e := tasks.Get(r.Context(), tx, p.ID, r.PathValue("id"))
		if e != nil {
			return nil, 0, e
		}
		if old.Revision != in.ExpectedRevision {
			return nil, 0, tasks.Conflict()
		}
		t, e := tasks.Complete(r.Context(), tx, p.ID, zone, now, old, *in.Complete, in.MoveToToday)
		return t, 200, e
	})
}
func (s *Server) deleteTask(w http.ResponseWriter, r *http.Request) {
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
		old, e := tasks.Get(r.Context(), tx, p.ID, r.PathValue("id"))
		if e != nil {
			return nil, 0, e
		}
		if old.Revision != in.ExpectedRevision {
			return nil, 0, tasks.Conflict()
		}
		return map[string]bool{"ok": true}, 200, tasks.Delete(r.Context(), tx, p.ID, zone, now, old)
	})
}
func (s *Server) listTasks(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string) (any, error) {
		q := r.URL.Query()
		limit := 50
		if v := q.Get("limit"); v != "" {
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || n > 100 {
				return nil, tasks.Invalid("Limit must be 1–100")
			}
			limit = n
		}
		cursor := q.Get("cursor")
		if cursor != "" {
			if _, e := uuid.Parse(cursor); e != nil {
				return nil, tasks.Invalid("Invalid cursor")
			}
		}
		priority, status, group, view := q.Get("priority"), q.Get("status"), q.Get("groupId"), q.Get("view")
		if priority != "" && priority != "low" && priority != "medium" && priority != "high" {
			return nil, tasks.Invalid("Invalid priority filter")
		}
		if status != "" && status != "complete" && status != "incomplete" {
			return nil, tasks.Invalid("Invalid status filter")
		}
		if group != "" && group != "none" {
			if _, e := uuid.Parse(group); e != nil {
				return nil, tasks.Invalid("Invalid group filter")
			}
		}
		switch view {
		case "", "all", "today", "upcoming", "overdue", "unscheduled", "previously-unfinished":
		default:
			return nil, tasks.Invalid("Invalid task view")
		}
		loc, e := time.LoadLocation(zone)
		if e != nil {
			return nil, e
		}
		now := s.now().UTC()
		today := now.In(loc).Format("2006-01-02")
		rows, e := tx.Query(r.Context(), `SELECT `+tasks.Columns+` FROM tasks WHERE user_id=$1 AND deleted_at IS NULL
 AND ($2='' OR id>NULLIF($2,'')::uuid) AND ($3='' OR strpos(lower(title),lower($3))>0)
 AND ($4='' OR priority=$4) AND ($5='' OR status=$5)
 AND ($6='' OR ($6='none' AND group_id IS NULL) OR group_id=NULLIF(NULLIF($6,'none'),'')::uuid)
 AND ($7 IN ('','all') OR ($7='today' AND scheduled_date=$8::date) OR ($7='upcoming' AND scheduled_date>$8::date)
 OR ($7='overdue' AND status='incomplete' AND deadline<$9) OR ($7='unscheduled' AND scheduled_date IS NULL)
 OR ($7='previously-unfinished' AND status='incomplete' AND scheduled_date<$8::date))
 ORDER BY id LIMIT $10`, p.ID, cursor, q.Get("search"), priority, status, group, view, today, now, limit+1)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		items := []tasks.Task{}
		for rows.Next() {
			t, e := tasks.Scan(rows)
			if e != nil {
				return nil, e
			}
			items = append(items, t)
		}
		if e = rows.Err(); e != nil {
			return nil, e
		}
		var next *string
		if len(items) > limit {
			v := items[limit-1].ID
			next = &v
			items = items[:limit]
		}
		return map[string]any{"items": items, "nextCursor": next}, nil
	})
}
