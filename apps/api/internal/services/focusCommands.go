package services

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
)

func FocusStateCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	return Active(ctx, tx, p.ID, now)
}
func StartFocusCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.Focus()
	if e != nil {
		return nil, 0, e
	}
	var duration []int64
	if in.DurationMinutes != nil {
		duration = append(duration, *in.DurationMinutes)
	}
	out, e := Start(ctx, tx, p.ID, in.TaskID, in.Kind, now, duration...)
	return out, models.Created, e
}
func ChangeFocusCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.RevisionCommand()
	if e != nil {
		return nil, 0, e
	}
	if in.ExpectedRevision < 1 {
		return nil, 0, Invalid("Provide expectedRevision")
	}
	out, e := Change(ctx, tx, p.ID, params.ID, params.Action, in.ExpectedRevision, now)
	return out, models.Updated, e
}
func TaskFocusCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	return History(ctx, tx, p.ID, params.ID, now)
}
