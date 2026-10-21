package server

import (
	"errors"
	"focuscalendar/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

type groupInput struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}
type group struct {
	groupInput
	ID       string `json:"id"`
	Revision int64  `json:"revision"`
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validateGroup(in *groupInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > 100 {
		return tasks.Invalid("Use a group name of 1–100 characters")
	}
	if !colorPattern.MatchString(in.Color) {
		return tasks.Invalid("Use a six-digit hex color")
	}
	return nil
}
func getGroup(tx pgx.Tx, r *http.Request, user string) (group, error) {
	var g group
	id := r.PathValue("id")
	if _, e := uuid.Parse(id); e != nil {
		return g, tasks.Missing()
	}
	e := tx.QueryRow(r.Context(), `SELECT id::text,name,color,revision FROM groups WHERE user_id=$1 AND id=$2`, user, id).Scan(&g.ID, &g.Name, &g.Color, &g.Revision)
	if errors.Is(e, pgx.ErrNoRows) {
		e = tasks.Missing()
	}
	return g, e
}
func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time) (any, error) {
		rows, e := tx.Query(r.Context(), `SELECT id::text,name,color,revision FROM groups WHERE user_id=$1 ORDER BY lower(name),id`, p.ID)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		items := []group{}
		for rows.Next() {
			var g group
			if e = rows.Scan(&g.ID, &g.Name, &g.Color, &g.Revision); e != nil {
				return nil, e
			}
			items = append(items, g)
		}
		return map[string]any{"items": items}, rows.Err()
	})
}
func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		var in groupInput
		if e := parseInput(raw, &in); e != nil {
			return nil, 0, e
		}
		if e := validateGroup(&in); e != nil {
			return nil, 0, e
		}
		g := group{groupInput: in, ID: uuid.NewString(), Revision: 1}
		_, e := tx.Exec(r.Context(), `INSERT INTO groups(user_id,id,name,color) VALUES($1,$2,$3,$4)`, p.ID, g.ID, g.Name, g.Color)
		return g, 201, e
	})
}
func (s *Server) editGroup(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		g, e := getGroup(tx, r, p.ID)
		if e != nil {
			return nil, 0, e
		}
		rev, e := expected(raw)
		if e != nil {
			return nil, 0, e
		}
		if rev != g.Revision {
			return nil, 0, tasks.Conflict()
		}
		var in groupInput
		if e = mergePatch(raw, g.groupInput, &in); e != nil {
			return nil, 0, e
		}
		if e = validateGroup(&in); e != nil {
			return nil, 0, e
		}
		g.groupInput = in
		g.Revision++
		_, e = tx.Exec(r.Context(), `UPDATE groups SET name=$3,color=$4,revision=revision+1 WHERE user_id=$1 AND id=$2`, p.ID, g.ID, g.Name, g.Color)
		return g, 200, e
	})
}
func (s *Server) deleteGroup(w http.ResponseWriter, r *http.Request) {
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
		g, e := getGroup(tx, r, p.ID)
		if e != nil {
			return nil, 0, e
		}
		if g.Revision != in.ExpectedRevision {
			return nil, 0, tasks.Conflict()
		}
		rows, e := tx.Query(r.Context(), `SELECT `+tasks.Columns+` FROM tasks WHERE user_id=$1 AND group_id=$2 AND deleted_at IS NULL`, p.ID, g.ID)
		if e != nil {
			return nil, 0, e
		}
		affected := []tasks.Task{}
		for rows.Next() {
			t, err := tasks.Scan(rows)
			if err != nil {
				rows.Close()
				return nil, 0, err
			}
			affected = append(affected, t)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, 0, e
		}
		// Clear even soft-deleted tasks to satisfy the composite FK; historical events retain their original state.
		_, e = tx.Exec(r.Context(), `UPDATE tasks SET group_id=NULL,revision=revision+1,updated_at=$3 WHERE user_id=$1 AND group_id=$2`, p.ID, g.ID, now)
		if e != nil {
			return nil, 0, e
		}
		for _, old := range affected {
			next := old
			next.GroupID = nil
			next.Revision++
			next.UpdatedAt = now
			if e = tasks.Event(r.Context(), tx, p.ID, zone, "group_cleared", now, &old, next); e != nil {
				return nil, 0, e
			}
		}
		_, e = tx.Exec(r.Context(), `UPDATE recurrence_series SET group_id=NULL WHERE user_id=$1 AND group_id=$2`, p.ID, g.ID)
		if e != nil {
			return nil, 0, e
		}
		_, e = tx.Exec(r.Context(), `DELETE FROM groups WHERE user_id=$1 AND id=$2`, p.ID, g.ID)
		return map[string]bool{"ok": true}, 200, e
	})
}
