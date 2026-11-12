package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5/pgconn"
	"strings"
	"testing"
	"time"
)

func TestJobFailuresAreClassifiedAndRedacted(t *testing.T) {
	for _, tc := range []struct {
		operation, category string
		err                 error
	}{
		{"focus.sweep", "internal", errors.New("secret SQL and user data")},
		{"notifications.run", "database_unavailable", &pgconn.PgError{Code: "08006", Message: "secret"}},
		{"jobs.query", "database_timeout", context.DeadlineExceeded},
	} {
		t.Run(tc.operation, func(t *testing.T) {
			var out bytes.Buffer
			ctx := WithRequest(context.Background(), strings.Repeat("a", 24))
			SetRoute(ctx, "POST /internal/jobs")
			JobFailure(ctx, Logger(&out, "", "production"), tc.operation, time.Now().Add(-time.Second), tc.err)
			if strings.Contains(out.String(), "secret") {
				t.Fatal(out.String())
			}
			var event map[string]any
			if err := json.Unmarshal(out.Bytes(), &event); err != nil {
				t.Fatal(err)
			}
			exported := safeLog(event)
			if exported["request_id"] != strings.Repeat("a", 24) || exported["operation"] != tc.operation || exported["error_category"] != tc.category || exported["duration_ms"].(float64) < 1000 {
				t.Fatal(exported)
			}
		})
	}
	var out bytes.Buffer
	logger := Logger(&out, "", "production")
	JobFailure(context.Background(), logger, "jobs.query", time.Now(), errors.New("secret"))
	JobFailure(WithRequest(context.Background(), strings.Repeat("a", 24)), logger, "jobs.query", time.Now(), nil)
	if out.Len() != 0 {
		t.Fatal(out.String())
	}
}
