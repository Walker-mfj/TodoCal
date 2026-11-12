package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"
)

func validEndpoint(v string) bool {
	u, e := url.Parse(v)
	return e == nil && u.Scheme == "https" && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == ""
}

type dailyBudget struct {
	mu          sync.Mutex
	day         string
	used, limit int
}

func (b *dailyBudget) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	day := time.Now().UTC().Format("2006-01-02")
	if day > b.day {
		b.day = day
		b.used = 0
	}
	if b.used >= b.limit {
		return false
	}
	b.used++
	return true
}

// logSender accepts only structured diagnostics, never arbitrary application
// log messages. Limits are per process; provider quotas must cap the account.
type logSender struct {
	queue         chan []byte
	cancel        context.CancelFunc
	done          chan struct{}
	budget        dailyBudget
	routineBudget dailyBudget
	dropped       atomic.Uint64
	sample        atomic.Uint64
}

func newLogSender(endpoint, token string) *logSender {
	s := &logSender{queue: make(chan []byte, 64), done: make(chan struct{}), budget: dailyBudget{limit: 10000}, routineBudget: dailyBudget{limit: 1000}}
	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel
	client := &http.Client{Timeout: 2 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	go func() {
		defer close(s.done)
		for {
			select {
			case <-ctx.Done():
				return
			case b := <-s.queue:
				req, e := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
				if e != nil {
					s.dropped.Add(1)
					continue
				}
				req.Header.Set("Authorization", "Bearer "+token)
				req.Header.Set("Content-Type", "application/json")
				resp, e := client.Do(req)
				if e != nil {
					s.dropped.Add(1)
					continue
				}
				_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
				_ = resp.Body.Close()
				if resp.StatusCode >= 300 {
					s.dropped.Add(1)
				}
			}
		}
	}()
	return s
}
func (s *logSender) Write(p []byte) (int, error) {
	var fields map[string]any
	if json.Unmarshal(p, &fields) != nil {
		return len(p), nil
	}
	fields = safeLog(fields)
	if len(fields) == 0 {
		return len(p), nil
	}
	// Routine traffic may use at most 10% of the total daily budget.
	// Sampling alone cannot protect the error budget against sustained traffic.
	critical := fields["event"] == "scheduled_operation_failed" || fields["error_category"] != nil
	if fields["event"] == "http_request_completed" {
		n, _ := fields["status_code"].(float64)
		critical = critical || n >= 500 || fields["response_complete"] == false
		if !critical && s.sample.Add(1)%100 != 0 {
			return len(p), nil
		}
	}
	if !critical && !s.routineBudget.allow() {
		s.dropped.Add(1)
		return len(p), nil
	}
	fields["telemetry_dropped_total"] = s.dropped.Load()
	b, e := json.Marshal(fields)
	if e != nil || len(b) > 8192 || !s.budget.allow() {
		s.dropped.Add(1)
		return len(p), nil
	}
	select {
	case s.queue <- b:
	default:
		s.dropped.Add(1)
	}
	return len(p), nil
}
func (s *logSender) Close() { s.cancel(); <-s.done }
func safeLog(in map[string]any) map[string]any {
	event, _ := in["event"].(string)
	if event != "http_request_completed" && event != "db_pool_summary" && event != "scheduled_operation_failed" {
		return nil
	}
	out := map[string]any{"event": event}
	stringsIn := map[string]string{}
	for k, v := range in {
		if s, ok := v.(string); ok {
			stringsIn[k] = s
		}
	}
	for k, v := range FilterContext(stringsIn) {
		out[k] = v
	}
	for _, k := range []string{"status_code", "duration_ms", "db_acquire_ms", "db_query_ms", "db_acquire_count", "db_query_count", "interval_ms", "acquired_conns", "idle_conns", "total_conns", "max_conns", "empty_acquire_delta", "canceled_acquire_delta", "acquire_duration_delta_ms"} {
		if n, ok := in[k].(float64); ok {
			out[k] = n
		}
	}
	for _, k := range []string{"response_complete", "db_context_already_done"} {
		if b, ok := in[k].(bool); ok {
			out[k] = b
		}
	}
	if revisionPattern.MatchString(stringsIn["release"]) {
		out["release"] = stringsIn["release"]
	}
	switch stringsIn["environment"] {
	case "production", "staging", "development":
		out["environment"] = stringsIn["environment"]
	}
	out["service"] = "api"
	if t, e := time.Parse(time.RFC3339Nano, stringsIn["time"]); e == nil {
		out["dt"] = t.UTC().Format(time.RFC3339Nano)
	}
	return out
}
