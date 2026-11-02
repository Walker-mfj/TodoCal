package controllers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestScheduledJobsRequireDedicatedSecret(t *testing.T) {
	calls := 0
	s := New(nil, "http://localhost:3000", false)
	secret := strings.Repeat("j", 32)
	s.ConfigureJobs(secret, func(context.Context) (any, error) { calls++; return map[string]int{"accountsProcessed": 2}, nil })
	invoke := func(token string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/internal/jobs", strings.NewReader("{}"))
		r.Header.Set("Origin", "http://localhost:3000")
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Authorization", token)
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	for _, token := range []string{"", "Bearer incorrect", "Bearer " + secret + "extra"} {
		if w := invoke(token); w.Code != http.StatusForbidden {
			t.Fatal(w.Code)
		}
	}
	if calls != 0 {
		t.Fatal("unauthorized job ran")
	}
	if w := invoke("Bearer " + secret); w.Code != 200 || !strings.Contains(w.Body.String(), "accountsProcessed") {
		t.Fatal(w.Code, w.Body.String())
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	s.ConfigureJobs("", func(context.Context) (any, error) { t.Fatal("unconfigured job ran"); return nil, nil })
	if w := invoke("Bearer "); w.Code != 503 {
		t.Fatal(w.Code)
	}
	s.ConfigureJobs(secret, func(context.Context) (any, error) { return nil, errors.New("sensitive database details") })
	if w := invoke("Bearer " + secret); w.Code != 503 || strings.Contains(w.Body.String(), "sensitive") {
		t.Fatal(w.Code, w.Body.String())
	}
}
