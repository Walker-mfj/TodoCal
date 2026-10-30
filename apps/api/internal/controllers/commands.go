package controllers

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"focuscalendar/internal/dto"
	"focuscalendar/internal/models"
	"focuscalendar/internal/services"
)

func domainError(w http.ResponseWriter, err error) {
	var f *services.Fault
	if errors.As(err, &f) {
		status := 500
		switch f.Code {
		case "validation", "idempotency_key":
			status = 422
		case "not_found":
			status = 404
		case "revision_conflict", "idempotency_conflict", "undo_expired", "focus_active", "registration":
			status = 409
		case "unauthenticated", "credentials":
			status = 401
		case "rate_limit":
			status = 429
			w.Header().Set("Retry-After", "900")
		}
		fail(w, status, f.Code, f.Message)
	} else {
		internal(w, err)
	}
}

func (s *Server) mutate(w http.ResponseWriter, r *http.Request, op services.Operation) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 16 || len(key) > 128 || strings.TrimSpace(key) != key {
		fail(w, 422, "idempotency_key", "Provide an Idempotency-Key of 16–128 characters")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16384))
	if err != nil {
		fail(w, 422, "validation", "Request body is too large")
		return
	}
	hash := tokenHash(r.Method + "\n" + r.URL.RequestURI() + "\n" + string(raw))
	body, status, err := services.Execute(r.Context(), s.pool, s.now, p, key, hash, dto.Command(raw), parameters(r), op)
	if err != nil {
		domainError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	httpStatus := http.StatusOK
	if status == models.Created {
		httpStatus = http.StatusCreated
	}
	w.WriteHeader(httpStatus)
	_, _ = w.Write(append(body, '\n'))
}
func (s *Server) view(w http.ResponseWriter, r *http.Request, op services.Query) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	out, err := services.View(r.Context(), s.pool, s.now, p, parameters(r), op)
	if err != nil {
		domainError(w, err)
		return
	}
	writeJSON(w, 200, out)
}

func parameters(r *http.Request) services.Parameters {
	return services.Parameters{ID: r.PathValue("id"), Action: r.PathValue("action"), Date: r.PathValue("date"), Query: services.Values(r.URL.Query())}
}
