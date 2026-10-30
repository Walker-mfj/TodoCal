package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
)

func ListInvalidTimeExceptions(ctx context.Context, db DBTX, userID string, from string, to string) ([]map[string]string, error) {
	rows, err := db.Query(ctx, `SELECT series_id::text,original_occurrence_date::text,reason FROM recurrence_exceptions WHERE user_id=$1 AND original_occurrence_date>=$2::date AND original_occurrence_date<$3::date AND reason='invalid_local_time' ORDER BY original_occurrence_date,series_id`, userID, from, to)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (map[string]string, error) { return scanWarning(row) })
}
