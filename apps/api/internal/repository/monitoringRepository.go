package repository

import (
	"context"
)

func ReserveMonitoringBudget(ctx context.Context, db DBTX, limit int, resultUsed *int) error {
	return db.QueryRow(ctx, `INSERT INTO monitoring_budget(singleton, day, used)
 VALUES (true, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date, 1)
 ON CONFLICT (singleton) DO UPDATE SET
 day=EXCLUDED.day,
 used=CASE WHEN monitoring_budget.day < EXCLUDED.day THEN 1 ELSE monitoring_budget.used+1 END
 WHERE monitoring_budget.day < EXCLUDED.day OR (monitoring_budget.day = EXCLUDED.day AND monitoring_budget.used < $1)
 RETURNING used`, limit).Scan(resultUsed)
}
