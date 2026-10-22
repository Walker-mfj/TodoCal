package server

import (
	"focuscalendar/internal/analytics"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

func (s *Server) periodReport(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time) (any, error) {
		return analytics.Period(r.Context(), tx, p.ID, zone, r.URL.Query().Get("period"), r.URL.Query().Get("date"), now)
	})
}
