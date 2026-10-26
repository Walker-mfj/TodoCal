// Package monitoring sends only bounded, scrubbed error events. It never retries.
package monitoring

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
	"github.com/google/uuid"
)

const DailyLimit = 1000

type Reporter struct {
	mu      sync.Mutex
	queue   chan *sentry.Event
	done    chan struct{}
	closed  bool
	window  time.Time
	count   int
	seen    map[[32]byte]time.Time
	release string
	reserve func(context.Context) bool
	send    func(*sentry.Event)
}

func New(dsn, release string, reserve func(context.Context) bool) (*Reporter, error) {
	if dsn == "" {
		return nil, nil
	}
	u, err := url.Parse(dsn)
	if err != nil || u.Scheme != "https" || !strings.HasSuffix(u.Hostname(), ".betterstackdata.com") {
		return nil, errors.New("invalid Better Stack DSN")
	}
	if _, err = sentry.NewDsn(dsn); err != nil {
		return nil, errors.New("invalid Better Stack DSN")
	}
	transport := sentry.NewHTTPSyncTransport()
	transport.Configure(sentry.ClientOptions{Dsn: dsn, HTTPClient: &http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}})
	return newReporter(release, reserve, transport.SendEvent), nil
}
func newReporter(release string, reserve func(context.Context) bool, send func(*sentry.Event)) *Reporter {
	r := &Reporter{queue: make(chan *sentry.Event, 16), done: make(chan struct{}), seen: make(map[[32]byte]time.Time), release: release, reserve: reserve, send: send}
	go func() {
		defer close(r.done)
		for e := range r.queue {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			allowed := r.reserve(ctx)
			cancel()
			if allowed {
				r.send(e)
			}
		}
	}()
	return r
}
func (r *Reporter) Report(e *sentry.Event, source string) {
	if r == nil || e == nil {
		return
	}
	e = sanitize(e, source, r.release)
	if len(e.Exception) == 0 {
		return
	}
	b, _ := json.Marshal(e.Exception)
	key := sha256.Sum256(append([]byte(source), b...))
	now := time.Now()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	if now.Sub(r.window) >= time.Minute {
		r.window = now
		r.count = 0
	}
	if r.count >= 10 {
		return
	}
	if last, ok := r.seen[key]; ok && now.Sub(last) < 5*time.Minute {
		return
	}
	for k, v := range r.seen {
		if now.Sub(v) >= 5*time.Minute {
			delete(r.seen, k)
		}
	}
	select {
	case r.queue <- e:
		r.count++
		r.seen[key] = now
	default:
	}
}
func (r *Reporter) Close() {
	if r == nil {
		return
	}
	r.mu.Lock()
	if !r.closed {
		r.closed = true
		close(r.queue)
	}
	r.mu.Unlock()
	select {
	case <-r.done:
	case <-time.After(5 * time.Second):
	}
}

var symbol = regexp.MustCompile(`^[a-zA-Z0-9_.$*/<>()[\] -]{1,160}$`)

func safeSymbol(v string) string {
	if symbol.MatchString(v) {
		return v
	}
	return "Error"
}
func sanitize(e *sentry.Event, source, release string) *sentry.Event {
	platform := "go"
	if source == "browser" {
		platform = "javascript"
		if regexp.MustCompile(`^[a-f0-9]{40}$`).MatchString(e.Release) {
			release = e.Release
		}
	}
	out := &sentry.Event{EventID: sentry.EventID(strings.ReplaceAll(uuid.NewString(), "-", "")), Timestamp: time.Now().UTC(), Level: sentry.LevelError, Platform: platform, Environment: "production", Release: safeSymbol(release), Tags: map[string]string{"service": source}}
	for _, ex := range e.Exception {
		if len(out.Exception) >= 3 {
			break
		}
		clean := sentry.Exception{Type: safeSymbol(ex.Type), Value: "Error details removed for privacy"}
		if ex.Stacktrace != nil {
			clean.Stacktrace = &sentry.Stacktrace{}
			frames := ex.Stacktrace.Frames
			if len(frames) > 30 {
				frames = frames[len(frames)-30:]
			}
			for _, f := range frames {
				filename := path.Base(f.Filename)
				if source == "browser" {
					u, err := url.Parse(f.Filename)
					if err != nil || !strings.HasPrefix(u.Path, "/_next/static/") {
						continue
					}
					filename = u.Path
				}
				if len(filename) > 250 || strings.ContainsAny(filename, "\r\n") {
					continue
				}
				clean.Stacktrace.Frames = append(clean.Stacktrace.Frames, sentry.Frame{Filename: filename, Function: safeSymbol(f.Function), Lineno: f.Lineno, Colno: f.Colno, InApp: true})
			}
		}
		out.Exception = append(out.Exception, clean)
	}
	return out
}

func (r *Reporter) Capture(err error) {
	if r == nil {
		return
	}
	e := sentry.NewEvent()
	e.SetException(err, 3)
	r.Report(e, "api")
}
func (r *Reporter) Panic() {
	if r == nil {
		return
	}
	r.Report(&sentry.Event{Exception: []sentry.Exception{{Type: "panic", Stacktrace: sentry.NewStacktrace()}}}, "api")
}
