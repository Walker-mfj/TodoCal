package controllers

import (
	"net/http"

	"focuscalendar/internal/services"
)

func (s *Server) CreateTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.CreateTaskCommand)
}
func (s *Server) GetTask(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.GetTaskCommand)
}
func (s *Server) EditTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.EditTaskCommand)
}
func (s *Server) CompleteTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.CompleteTaskCommand)
}
func (s *Server) DeleteTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.DeleteTaskCommand)
}
func (s *Server) ListTasks(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.ListTasksCommand)
}

func (s *Server) RestoreTask(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.RestoreTaskCommand)
}
func (s *Server) RestoreSeries(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, services.RestoreSeriesCommand)
}

func (s *Server) FollowingDeletionPreview(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, services.FollowingDeletionPreviewCommand)
}
