package services

import (
	"context"
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
)

func CreateSeriesCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.Series()
	if e != nil {
		return nil, 0, e
	}
	out, e := CreateSeries(ctx, tx, p.ID, zone, now, in)
	return out, models.Created, e
}
func StopSeriesCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.RevisionCommand()
	if e != nil {
		return nil, 0, e
	}
	if in.ExpectedRevision < 1 {
		return nil, 0, Invalid("Provide expectedRevision")
	}
	out, e := Stop(ctx, tx, p.ID, zone, params.ID, now, in.ExpectedRevision)
	return out, models.Updated, e
}
func CalendarCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	from, to := params.Query.Get("from"), params.Query.Get("to")

	if e := Materialize(ctx, tx, p.ID, zone, from, to, now); e != nil {
		return nil, e
	}
	days := []Day{}
	live := []Task{}
	for date := from; date < to; date = localdate.Add(date, 1) {
		day, e := DayReport(ctx, tx, p.ID, zone, date, now)
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
	warnings, e := repository.ListInvalidTimeExceptions(ctx, tx, p.ID, from, to)
	if e != nil {
		return nil, e
	}
	return map[string]any{"from": from, "to": to, "tasks": live, "days": days, "warnings": warnings}, nil
}
func DayDetailsCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	date := params.Date

	if e := Materialize(ctx, tx, p.ID, zone, date, localdate.Add(date, 1), now); e != nil {
		return nil, e
	}
	return AnalyticsDayReport(ctx, tx, p.ID, zone, date, now)
}
func GetSeriesCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	return GetSeries(ctx, tx, p.ID, params.ID)
}
