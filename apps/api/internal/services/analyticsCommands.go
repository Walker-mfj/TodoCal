package services

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

func PeriodReportCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	return Period(ctx, tx, p.ID, zone, params.Query.Get("period"), params.Query.Get("date"), now)
}
