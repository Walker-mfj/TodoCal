package controllers

import (
	"net/http"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/services"
)

func (s *Server) CreateSeries(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.CreateSeriesCommand)
}
func (s *Server) StopSeries(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.StopSeriesCommand)
}
func (s *Server) Calendar(w http.ResponseWriter, r *http.Request) {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if _, e := localdate.Parse(from); e != nil {
		fail(w, 422, "validation", "Use a valid from date")
		return
	}
	if _, e := localdate.Parse(to); e != nil {
		fail(w, 422, "validation", "Use a valid to date")
		return
	}
	if n := localdate.Days(from, to); n < 1 || n > 93 {
		fail(w, 422, "validation", "Calendar range must be 1–93 days, end-exclusive")
		return
	}
	s.view(w, r, services.CalendarCommand)
}
func (s *Server) DayDetails(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	if _, e := localdate.Parse(date); e != nil {
		fail(w, 422, "validation", "Use a valid date")
		return
	}
	s.view(w, r, services.DayDetailsCommand)
}

func (s *Server) GetSeries(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.GetSeriesCommand)
}
