package diagnostics

import (
	"context"
	"errors"
	"net"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// Category never returns an error message or a database-supplied identifier.
func Category(err error, stage string) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, context.Canceled) {
		return "request_cancelled"
	}
	var timeout net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &timeout) && timeout.Timeout()) {
		switch stage {
		case "pool_acquire":
			return "db_pool_acquire_timeout"
		case "query":
			return "database_timeout"
		default:
			return "deadline_exceeded"
		}
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch {
		case strings.HasPrefix(pg.Code, "23"):
			return "database_constraint"
		case strings.HasPrefix(pg.Code, "08"), pg.Code == "57P01", pg.Code == "57P02", pg.Code == "57P03":
			return "database_unavailable"
		case pg.Code == "57014":
			return "database_timeout"
		}
	}
	var connection *pgconn.ConnectError
	if errors.As(err, &connection) {
		return "database_unavailable"
	}
	return "internal"
}
