package services

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
)

func ScheduleTaskCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, err := input.Schedule()
	if err != nil {
		return nil, 0, err
	}
	for _, key := range []string{"scheduledDate", "startTime", "endTime"} {
		if !in.Present[key] {
			return nil, 0, Invalid("Provide " + key + " (null clears it)")
		}
	}
	if in.ExpectedRevision < 1 {
		return nil, 0, Invalid("Provide expectedRevision")
	}
	out, err := Reschedule(ctx, tx, p.ID, zone, params.ID, now, in.Schedule, in.ExpectedRevision)
	return out, models.Updated, err
}
func UndoScheduleCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	if err := input.Empty(); err != nil {
		return nil, 0, err
	}
	out, err := UndoSchedule(ctx, tx, p.ID, zone, params.ID, now)
	return out, models.Updated, err
}
