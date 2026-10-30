package controllers

import (
	"net/http"

	"focuscalendar/internal/services"
)

func (s *Server) ScheduleTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.ScheduleTaskCommand)
}
func (s *Server) UndoSchedule(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.UndoScheduleCommand)
}
