package controllers

import (
	"net/http"

	"focuscalendar/internal/services"
)

func (s *Server) PeriodReport(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.PeriodReportCommand)
}
