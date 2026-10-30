package services

import (
	"context"
	"time"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type FocusSession = models.FocusSession
type FocusState = models.FocusState

func elapsedFocus(s *FocusSession, now time.Time) *FocusSession {
	if s == nil {
		return nil
	}
	s.ElapsedSeconds = ElapsedMicroseconds(s.Accumulated, s.TargetSeconds, s.RunningSince, now) / 1000000
	if s.Kind == "focus" {
		s.FocusSeconds = s.ElapsedSeconds
	}
	return s
}
func closeInterval(ctx context.Context, tx pgx.Tx, user string, s *FocusSession, at time.Time) error {
	if s.RunningSince == nil {
		return nil
	}
	at = focusMaxTime(at, *s.RunningSince)
	_, e := repository.CloseFocusInterval(ctx, tx, user, s.ID, at)
	return e
}
func focusMaxTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return b
	}
	return a
}

// Callers hold the same account transaction lock used by all account mutations.
func settle(ctx context.Context, tx pgx.Tx, user string, now time.Time) error {
	s, e := repository.FindRunningFocus(ctx, tx, user)
	elapsedFocus(s, now)
	if e != nil || s == nil {
		return e
	}
	if ElapsedMicroseconds(s.Accumulated, s.TargetSeconds, s.RunningSince, now) < s.TargetSeconds*1000000 {
		return nil
	}
	end := time.UnixMicro(s.RunningSince.UnixMicro() + s.TargetSeconds*1000000 - s.Accumulated).UTC()
	if e = closeInterval(ctx, tx, user, s, end); e != nil {
		return e
	}
	pom := 0
	if s.Kind == "focus" {
		pom = 1
	}
	_, e = repository.CompleteFocus(ctx, tx, user, s.ID, end, pom)
	return e
}
func Active(ctx context.Context, tx pgx.Tx, user string, now time.Time) (FocusState, error) {
	out := FocusState{ServerNow: now.UTC(), NextKind: "focus"}
	if e := settle(ctx, tx, user, now); e != nil {
		return out, e
	}
	var e error
	out.Active, e = repository.FindActiveFocus(ctx, tx, user)
	elapsedFocus(out.Active, now)
	if e != nil {
		return out, e
	}
	out.Last, e = repository.FindLastFocus(ctx, tx, user)
	elapsedFocus(out.Last, now)
	if e != nil {
		return out, e
	}
	e = repository.CountCompletedFocus(ctx, tx, user, &out.CompletedFocusSessions)
	if out.Last != nil && out.Last.Kind == "focus" && out.Last.Pomodoros == 1 {
		out.NextKind = "short_break"
		if out.CompletedFocusSessions%4 == 0 {
			out.NextKind = "long_break"
		}
	}
	return out, e
}
func Start(ctx context.Context, tx pgx.Tx, user string, taskID *string, kind string, now time.Time, duration ...int64) (FocusState, error) {
	if kind != "focus" && kind != "short_break" && kind != "long_break" {
		return FocusState{}, Invalid("Choose focus, short_break, or long_break")
	}
	state, e := Active(ctx, tx, user, now)
	if e != nil {
		return state, e
	}
	if state.Active != nil {
		return state, &Fault{Code: "focus_active", Message: "End the current timer before starting another."}
	}
	var title *string
	var taskMinutes *int
	if taskID != nil {
		if kind != "focus" {
			return state, Invalid("Breaks cannot be linked to a task")
		}
		id, e := uuid.Parse(*taskID)
		if e != nil {
			return state, Missing()
		}
		v := id.String()
		taskID = &v
		task, e := GetTask(ctx, tx, user, v)
		if e != nil {
			return state, e
		}
		title = &task.Title
		taskMinutes = task.FocusMinutes
	}
	var minutes int64
	e = repository.ReadFocusDuration(ctx, tx, user, kind, &minutes)
	if e != nil {
		return state, e
	}
	id := uuid.NewString()
	if taskMinutes != nil {
		minutes = int64(*taskMinutes)
	}
	if len(duration) > 0 {
		if duration[0] < 1 || duration[0] > 180 {
			return FocusState{}, Invalid("Duration must be between 1 and 180 minutes")
		}
		minutes = duration[0]
	}
	_, e = repository.InsertFocus(ctx, tx, user, id, taskID, title, kind, minutes*60, now)
	if e != nil {
		return state, e
	}
	_, e = repository.InsertFirstFocusInterval(ctx, tx, user, id, now)
	if e != nil {
		return state, e
	}
	return Active(ctx, tx, user, now)
}
func Change(ctx context.Context, tx pgx.Tx, user, id, action string, revision int64, now time.Time) (FocusState, error) {
	parsed, e := uuid.Parse(id)
	if e != nil {
		return FocusState{}, Missing()
	}
	id = parsed.String()
	if e = settle(ctx, tx, user, now); e != nil {
		return FocusState{}, e
	}
	s, e := repository.FindFocus(ctx, tx, user, id)
	elapsedFocus(s, now)
	if e != nil {
		return FocusState{}, e
	}
	if s == nil {
		return FocusState{}, Missing()
	}
	if s.Status == "completed" || s.Status == "ended" {
		if action == "end" {
			return Active(ctx, tx, user, now)
		}
		return FocusState{}, Conflict()
	}
	if s.Revision != revision {
		return FocusState{}, Conflict()
	}
	elapsed := ElapsedMicroseconds(s.Accumulated, s.TargetSeconds, s.RunningSince, now)
	switch action {
	case "pause", "end":
		if action == "pause" && s.Status != "running" {
			return FocusState{}, Conflict()
		}
		if e = closeInterval(ctx, tx, user, s, now); e != nil {
			return FocusState{}, e
		}
		status := "paused"
		var ended *time.Time
		if action == "end" {
			status = "ended"
			end := focusMaxTime(now, s.StartedAt)
			ended = &end
		}
		_, e = repository.SaveStoppedFocus(ctx, tx, user, id, status, elapsed, ended)
	case "resume":
		if s.Status != "paused" {
			return FocusState{}, Conflict()
		}
		_, e = repository.AppendFocusInterval(ctx, tx, user, id, now)
		if e != nil {
			return FocusState{}, e
		}
		_, e = repository.ResumeFocus(ctx, tx, user, id, now)
	default:
		return FocusState{}, Invalid("Unknown timer action")
	}
	if e != nil {
		return FocusState{}, e
	}
	return Active(ctx, tx, user, now)
}

type TaskHistory = models.TaskHistory

func History(ctx context.Context, tx pgx.Tx, user, id string, now time.Time) (TaskHistory, error) {
	out := TaskHistory{Sessions: []*FocusSession{}}
	parsed, err := uuid.Parse(id)
	if err != nil {
		return out, Missing()
	}
	var exists bool
	err = repository.TaskExists(ctx, tx, user, parsed.String(), &exists)
	if err != nil {
		return out, err
	}
	if !exists {
		return out, Missing()
	}
	if err = settle(ctx, tx, user, now); err != nil {
		return out, err
	}
	sessions, err := repository.ListTaskFocusSessions(ctx, tx, user, parsed.String())
	if err != nil {
		return out, err
	}
	for _, session := range sessions {
		elapsedFocus(session, now)
		out.Sessions = append(out.Sessions, session)
		out.ActualFocusSeconds += session.FocusSeconds
	}
	return out, nil
}
