package focus

import (
	"context"
	"errors"
	"focuscalendar/internal/tasks"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

type Session struct {
	ID             string     `json:"id"`
	TaskID         *string    `json:"taskId"`
	TaskTitle      *string    `json:"taskTitle"`
	Kind           string     `json:"kind"`
	Status         string     `json:"status"`
	TargetSeconds  int64      `json:"targetSeconds"`
	ElapsedSeconds int64      `json:"elapsedSeconds"`
	FocusSeconds   int64      `json:"focusSeconds"`
	Pomodoros      int        `json:"pomodoros"`
	StartedAt      time.Time  `json:"startedAt"`
	EndedAt        *time.Time `json:"endedAt"`
	RunningSince   *time.Time `json:"runningSince"`
	Revision       int64      `json:"revision"`
	accumulated    int64
}
type State struct {
	Active                 *Session  `json:"active"`
	Last                   *Session  `json:"last"`
	NextKind               string    `json:"nextKind"`
	CompletedFocusSessions int64     `json:"completedFocusSessions"`
	ServerNow              time.Time `json:"serverNow"`
}

const columns = `id::text,task_id::text,task_title,kind,status,target_seconds,accumulated_us,running_since,started_at,ended_at,pomodoros,revision`

func scan(row pgx.Row, now time.Time) (*Session, error) {
	s := new(Session)
	e := row.Scan(&s.ID, &s.TaskID, &s.TaskTitle, &s.Kind, &s.Status, &s.TargetSeconds, &s.accumulated, &s.RunningSince, &s.StartedAt, &s.EndedAt, &s.Pomodoros, &s.Revision)
	if errors.Is(e, pgx.ErrNoRows) {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	s.ElapsedSeconds = ElapsedMicroseconds(s.accumulated, s.TargetSeconds, s.RunningSince, now) / 1000000
	if s.Kind == "focus" {
		s.FocusSeconds = s.ElapsedSeconds
	}
	return s, nil
}
func closeInterval(ctx context.Context, tx pgx.Tx, user string, s *Session, at time.Time) error {
	if s.RunningSince == nil {
		return nil
	}
	at = maxTime(at, *s.RunningSince)
	_, e := tx.Exec(ctx, `UPDATE focus_intervals SET ended_at=$3 WHERE user_id=$1 AND session_id=$2 AND ended_at IS NULL`, user, s.ID, at)
	return e
}
func maxTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return b
	}
	return a
}

// Callers hold the same account transaction lock used by all account mutations.
func settle(ctx context.Context, tx pgx.Tx, user string, now time.Time) error {
	s, e := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM focus_sessions WHERE user_id=$1 AND status='running'`, user), now)
	if e != nil || s == nil {
		return e
	}
	if ElapsedMicroseconds(s.accumulated, s.TargetSeconds, s.RunningSince, now) < s.TargetSeconds*1000000 {
		return nil
	}
	end := time.UnixMicro(s.RunningSince.UnixMicro() + s.TargetSeconds*1000000 - s.accumulated).UTC()
	if e = closeInterval(ctx, tx, user, s, end); e != nil {
		return e
	}
	pom := 0
	if s.Kind == "focus" {
		pom = 1
	}
	_, e = tx.Exec(ctx, `UPDATE focus_sessions SET status='completed',accumulated_us=target_seconds*1000000,running_since=NULL,ended_at=$3,pomodoros=$4,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, s.ID, end, pom)
	return e
}
func Active(ctx context.Context, tx pgx.Tx, user string, now time.Time) (State, error) {
	out := State{ServerNow: now.UTC(), NextKind: "focus"}
	if e := settle(ctx, tx, user, now); e != nil {
		return out, e
	}
	var e error
	out.Active, e = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM focus_sessions WHERE user_id=$1 AND status IN ('running','paused')`, user), now)
	if e != nil {
		return out, e
	}
	out.Last, e = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM focus_sessions WHERE user_id=$1 AND status IN ('completed','ended') ORDER BY sequence DESC LIMIT 1`, user), now)
	if e != nil {
		return out, e
	}
	e = tx.QueryRow(ctx, `SELECT count(*) FROM focus_sessions WHERE user_id=$1 AND pomodoros=1`, user).Scan(&out.CompletedFocusSessions)
	if out.Last != nil && out.Last.Kind == "focus" && out.Last.Pomodoros == 1 {
		out.NextKind = "short_break"
		if out.CompletedFocusSessions%4 == 0 {
			out.NextKind = "long_break"
		}
	}
	return out, e
}
func Start(ctx context.Context, tx pgx.Tx, user string, taskID *string, kind string, now time.Time) (State, error) {
	if kind != "focus" && kind != "short_break" && kind != "long_break" {
		return State{}, tasks.Invalid("Choose focus, short_break, or long_break")
	}
	state, e := Active(ctx, tx, user, now)
	if e != nil {
		return state, e
	}
	if state.Active != nil {
		return state, &tasks.Fault{409, "focus_active", "End the current timer before starting another."}
	}
	var title *string
	if taskID != nil {
		if kind != "focus" {
			return state, tasks.Invalid("Breaks cannot be linked to a task")
		}
		id, e := uuid.Parse(*taskID)
		if e != nil {
			return state, tasks.Missing()
		}
		v := id.String()
		taskID = &v
		task, e := tasks.Get(ctx, tx, user, v)
		if e != nil {
			return state, e
		}
		title = &task.Title
	}
	var minutes int64
	e = tx.QueryRow(ctx, `SELECT CASE $2 WHEN 'focus' THEN focus_minutes WHEN 'short_break' THEN short_break_minutes ELSE long_break_minutes END FROM settings WHERE user_id=$1`, user, kind).Scan(&minutes)
	if e != nil {
		return state, e
	}
	id := uuid.NewString()
	_, e = tx.Exec(ctx, `INSERT INTO focus_sessions(user_id,id,task_id,task_title,kind,status,target_seconds,running_since,started_at) VALUES($1,$2,$3,$4,$5,'running',$6,$7,$7)`, user, id, taskID, title, kind, minutes*60, now)
	if e != nil {
		return state, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO focus_intervals(user_id,session_id,ordinal,started_at) VALUES($1,$2,1,$3)`, user, id, now)
	if e != nil {
		return state, e
	}
	return Active(ctx, tx, user, now)
}
func Change(ctx context.Context, tx pgx.Tx, user, id, action string, revision int64, now time.Time) (State, error) {
	parsed, e := uuid.Parse(id)
	if e != nil {
		return State{}, tasks.Missing()
	}
	id = parsed.String()
	if e = settle(ctx, tx, user, now); e != nil {
		return State{}, e
	}
	s, e := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM focus_sessions WHERE user_id=$1 AND id=$2`, user, id), now)
	if e != nil {
		return State{}, e
	}
	if s == nil {
		return State{}, tasks.Missing()
	}
	if s.Status == "completed" || s.Status == "ended" {
		if action == "end" {
			return Active(ctx, tx, user, now)
		}
		return State{}, tasks.Conflict()
	}
	if s.Revision != revision {
		return State{}, tasks.Conflict()
	}
	elapsed := ElapsedMicroseconds(s.accumulated, s.TargetSeconds, s.RunningSince, now)
	switch action {
	case "pause", "end":
		if action == "pause" && s.Status != "running" {
			return State{}, tasks.Conflict()
		}
		if e = closeInterval(ctx, tx, user, s, now); e != nil {
			return State{}, e
		}
		status := "paused"
		var ended *time.Time
		if action == "end" {
			status = "ended"
			end := maxTime(now, s.StartedAt)
			ended = &end
		}
		_, e = tx.Exec(ctx, `UPDATE focus_sessions SET status=$3,accumulated_us=$4,running_since=NULL,ended_at=$5,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, id, status, elapsed, ended)
	case "resume":
		if s.Status != "paused" {
			return State{}, tasks.Conflict()
		}
		_, e = tx.Exec(ctx, `INSERT INTO focus_intervals(user_id,session_id,ordinal,started_at) SELECT $1,$2,COALESCE(max(ordinal),0)+1,$3 FROM focus_intervals WHERE user_id=$1 AND session_id=$2`, user, id, now)
		if e != nil {
			return State{}, e
		}
		_, e = tx.Exec(ctx, `UPDATE focus_sessions SET status='running',running_since=$3,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, id, now)
	default:
		return State{}, tasks.Invalid("Unknown timer action")
	}
	if e != nil {
		return State{}, e
	}
	return Active(ctx, tx, user, now)
}
