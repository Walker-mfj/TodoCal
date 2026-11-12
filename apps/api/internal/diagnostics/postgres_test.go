package diagnostics

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPGTracerSeparatesAcquireAndQuery(t *testing.T) {
	ctx := WithRequest(context.Background(), strings.Repeat("a", 24))
	tr := PGTracer{}
	ac := tr.TraceAcquireStart(ctx, nil, pgxpool.TraceAcquireStartData{})
	tr.TraceAcquireEnd(ac, nil, pgxpool.TraceAcquireEndData{})
	q := tr.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "secret sql", Args: []any{"password"}})
	tr.TraceQueryEnd(q, nil, pgx.TraceQueryEndData{Err: pgx.ErrNoRows})
	q = tr.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{})
	tr.TraceQueryEnd(q, nil, pgx.TraceQueryEndData{Err: context.DeadlineExceeded})
	s := SafeContext(ctx)
	if s["db_stage"] != "query" || s["error_category"] != "database_timeout" {
		t.Fatal(s)
	}
	if from(ctx).acquires != 1 || from(ctx).queries != 2 {
		t.Fatal("lost counts")
	}
}
func TestPGTracerCanceledAcquireAndPrivacy(t *testing.T) {
	var b bytes.Buffer
	h := HTTP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithCancel(r.Context())
		cancel()
		tr := PGTracer{}
		ac := tr.TraceAcquireStart(ctx, nil, pgxpool.TraceAcquireStartData{})
		tr.TraceAcquireEnd(ac, nil, pgxpool.TraceAcquireEndData{Err: context.Canceled})
		q := tr.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "secret sql", Args: []any{"password"}})
		tr.TraceQueryEnd(q, nil, pgx.TraceQueryEndData{Err: errors.New("secret db failure")})
		w.WriteHeader(500)
	}), slog.New(slog.NewJSONHandler(&b, nil)))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/", nil))
	for _, want := range []string{`"db_stage":"pool_acquire"`, `"error_category":"request_cancelled"`, `"db_context_already_done":true`} {
		if !strings.Contains(b.String(), want) {
			t.Fatal(b.String())
		}
	}
	for _, bad := range []string{"secret", "password"} {
		if strings.Contains(b.String(), bad) {
			t.Fatal(b.String())
		}
	}
}
func TestPoolAcquireTimeoutIntegration(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires dedicated TEST_DATABASE_URL")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	cfg.ConnConfig.Tracer = PGTracer{}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	bounded, stop := context.WithTimeout(WithRequest(ctx, strings.Repeat("a", 24)), 25*time.Millisecond)
	defer stop()
	_, err = pool.Acquire(bounded)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
	if got := SafeContext(bounded); got["db_stage"] != "pool_acquire" || got["error_category"] != "db_pool_acquire_timeout" {
		t.Fatal(got)
	}
}
