package server

import (
	"context"
	"fmt"
	"focuscalendar/internal/monitoring"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestMonitoringBudgetSurvivesConcurrentReservations(t *testing.T) {
	s, p := testServer(t)
	_, err := p.Exec(context.Background(), "TRUNCATE monitoring_budget")
	if err != nil {
		t.Fatal(err)
	}
	var got atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 40; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if reserveMonitoring(context.Background(), p, 10) {
				got.Add(1)
			}
		}()
	}
	wg.Wait()
	if got.Load() != 10 {
		t.Fatalf("want exactly 10 got %d", got.Load())
	}
	if reserveMonitoring(context.Background(), s.pool, 10) {
		t.Fatal("new caller bypassed durable cap")
	}
	_, err = p.Exec(context.Background(), "UPDATE monitoring_budget SET day = CURRENT_DATE - 1")
	if err != nil {
		t.Fatal(err)
	}
	if !reserveMonitoring(context.Background(), p, 10) {
		t.Fatal("new day failed to reset")
	}
}
func TestMonitoringDisabledAndOrigin(t *testing.T) {
	s, _ := testServer(t)
	if w := req(s, "POST", "/api/v1/monitoring/errors", map[string]any{"exception": map[string]any{"values": []any{}}}, nil, ""); w.Code != 204 {
		t.Fatal(w.Code)
	}
}

func TestMonitoringBudgetNeverMovesBackwards(t *testing.T) {
	_, p := testServer(t)
	_, err := p.Exec(context.Background(), "TRUNCATE monitoring_budget; INSERT INTO monitoring_budget(singleton,day,used) VALUES(true,(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date+1,1)")
	if err != nil {
		t.Fatal(err)
	}
	if reserveMonitoring(context.Background(), p, 10) {
		t.Fatal("stale day reservation accepted")
	}
	var future bool
	if err = p.QueryRow(context.Background(), "SELECT day > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date FROM monitoring_budget").Scan(&future); err != nil || !future {
		t.Fatal("budget date moved backwards", err)
	}
}
func TestInvalidMonitoringConfigLeavesAPIHealthy(t *testing.T) {
	s := New(nil, "http://localhost:3000", false)
	close := s.EnableMonitoring("invalid", "test")
	defer close()
	if w := req(s, "GET", "/healthz", nil, nil, ""); w.Code != 200 {
		t.Fatal(w.Code)
	}
}
func TestPanicRecoveryDoesNotReturnPartialSuccess(t *testing.T) {
	for _, started := range []bool{false, true} {
		t.Run(fmt.Sprint(started), func(t *testing.T) {
			s := New(nil, "http://localhost:3000", false)
			h := s.observe(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if started {
					w.Write([]byte("partial"))
				}
				panic("sensitive panic")
			}))
			w := httptest.NewRecorder()
			var recovered any
			func() { defer func() { recovered = recover() }(); h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil)) }()
			if started {
				if recovered != http.ErrAbortHandler {
					t.Fatal("must abort partial response", recovered)
				}
			} else if recovered != nil || w.Code != 500 || strings.Contains(w.Body.String(), "sensitive") {
				t.Fatal(w.Code, w.Body.String(), recovered)
			}
		})
	}
}
func TestAbortHandlerPreserved(t *testing.T) {
	s := New(nil, "http://localhost:3000", false)
	h := s.observe(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) }))
	defer func() {
		if recover() != http.ErrAbortHandler {
			t.Fatal("abort swallowed")
		}
	}()
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
}

func TestMonitoringIngestValidatesOriginAndPayload(t *testing.T) {
	s := New(nil, "http://localhost:3000", false)
	reporter, err := monitoring.New("https://public@s.test.betterstackdata.com/1", "test", func(context.Context) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	s.monitor = reporter
	defer reporter.Close()
	cases := []struct {
		name, origin, body string
		want               int
	}{
		{"valid", "http://localhost:3000", `{"exception":{"values":[{"type":"TypeError","value":"private"}]}}`, 204},
		{"wrong origin", "https://evil.example", `{"exception":{"values":[{"type":"Error"}]}}`, 403},
		{"invalid", "http://localhost:3000", `{"exception":{"values":[]}}`, 400},
		{"oversize", "http://localhost:3000", `{"exception":{"values":[{"type":"Error","value":"` + strings.Repeat("x", 40000) + `"}]}}`, 400},
		{"trailing payload", "http://localhost:3000", `{"exception":{"values":[{"type":"Error"}]}} {}`, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest("POST", "/api/v1/monitoring/errors", strings.NewReader(tc.body))
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Content-Type", "application/json")
			s.Handler().ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d", w.Code, tc.want)
			}
		})
	}
}
