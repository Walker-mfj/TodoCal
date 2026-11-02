package controllers

import (
	"focuscalendar/internal/services"
	"net/http"
)

func (s *Server) Notifications(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.GetNotificationsCommand)
}
func (s *Server) UpdateNotificationPreferences(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.EditNotificationPreferencesCommand)
}
func (s *Server) SubscribePush(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.SubscribePushCommand)
}
func (s *Server) RevokePush(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.RevokePushCommand)
}
