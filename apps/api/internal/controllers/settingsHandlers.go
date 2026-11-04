package controllers

import (
	"net/http"

	"focuscalendar/internal/services"
)

func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.GetSettingsCommand)
}
func (s *Server) EditSettings(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.EditSettingsCommand)
}

func (s *Server) EditWorkspaceSettings(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.EditWorkspaceSettingsCommand)
}
