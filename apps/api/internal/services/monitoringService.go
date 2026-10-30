package services

import (
	"context"

	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5/pgxpool"
)

func ReserveMonitoring(ctx context.Context, p *pgxpool.Pool, limit int) bool {
	var used int
	err := repository.ReserveMonitoringBudget(ctx, p, limit, &used)
	return err == nil
}
