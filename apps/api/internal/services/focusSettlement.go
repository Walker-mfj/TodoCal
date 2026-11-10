package services

import (
	"context"
	"time"

	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
)

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

// SettleFocus reconciles an expired timer without requiring a client read.
// The caller must hold the same account lock as regular Focus commands.
func SettleFocus(ctx context.Context, tx pgx.Tx, user string, now time.Time) error {
	return settle(ctx, tx, user, now)
}
