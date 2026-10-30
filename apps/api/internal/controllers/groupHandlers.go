package controllers

import (
	"net/http"

	"focuscalendar/internal/services"
)

func (s *Server) ListGroups(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.ListGroupsCommand)
}
func (s *Server) CreateGroup(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.CreateGroupCommand)
}
func (s *Server) EditGroup(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.EditGroupCommand)
}
func (s *Server) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.DeleteGroupCommand)
}
