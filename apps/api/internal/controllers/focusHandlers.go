package controllers

import (
	"net/http"

	"focuscalendar/internal/services"
)

func (s *Server) FocusState(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.FocusStateCommand)
}
func (s *Server) StartFocus(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.StartFocusCommand)
}
func (s *Server) ChangeFocus(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.ChangeFocusCommand)
}

func (s *Server) TaskFocus(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.TaskFocusCommand)
}
