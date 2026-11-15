package controllers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLegacyJobsEndpointIsNotRegistered(t *testing.T) {
	s := New(nil, "https://app.example.com", true)
	r := httptest.NewRequest(http.MethodPost, "/internal/jobs", strings.NewReader("{}"))
	r.Header.Set("Origin", "https://app.example.com")
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Authorization", "Bearer "+strings.Repeat("x", 32))
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusNotFound {
		t.Fatalf("retired jobs endpoint returned %d", w.Code)
	}
}
