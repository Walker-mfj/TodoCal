package workers

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type schedulerBackend struct {
	mu    sync.Mutex
	due   Deadlines
	calls int
	fail  int
	run   func(context.Context, Job) error
}

func (b *schedulerBackend) Next(context.Context) (Deadlines, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.calls++
	if b.fail > 0 {
		b.fail--
		return Deadlines{}, errors.New("temporary")
	}
	return b.due, nil
}
func (b *schedulerBackend) Run(ctx context.Context, job Job) error { return b.run(ctx, job) }
func await(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(time.Second):
		t.Fatal("scheduler did not progress")
	}
}

func TestSchedulerFocusRunsWhileDispatchBlocked(t *testing.T) {
	b := &schedulerBackend{due: Deadlines{Dispatch: time.Now(), Focus: time.Now().Add(30 * time.Millisecond)}}
	started, focused := make(chan struct{}), make(chan struct{})
	b.run = func(ctx context.Context, j Job) error {
		if j == Dispatch {
			close(started)
			<-ctx.Done()
			return ctx.Err()
		}
		b.mu.Lock()
		b.due[j] = time.Time{}
		b.mu.Unlock()
		if j == Focus {
			close(focused)
		}
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := NewScheduler(b)
	done := make(chan struct{})
	go func() { defer close(done); s.Run(ctx) }()
	await(t, started)
	await(t, focused)
	cancel()
	await(t, done)
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.calls > 20 {
		t.Fatalf("busy spin: %d queries", b.calls)
	}
}

func TestSchedulerWakeAndQueryRetryWithoutReconciliation(t *testing.T) {
	b := &schedulerBackend{fail: 1}
	fired := make(chan struct{})
	b.run = func(_ context.Context, j Job) error {
		b.mu.Lock()
		b.due[j] = time.Time{}
		b.mu.Unlock()
		close(fired)
		return nil
	}
	s := NewScheduler(b)
	s.retryBase = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); s.Run(ctx) }()
	b.mu.Lock()
	b.due[Dispatch] = time.Now()
	b.mu.Unlock()
	s.Wake()
	await(t, fired)
	cancel()
	await(t, done)
}

func TestSchedulerRetriesFailedWorkAndCoalescesWakes(t *testing.T) {
	b := &schedulerBackend{due: Deadlines{Focus: time.Now()}}
	fired := make(chan struct{})
	attempts := 0
	b.run = func(_ context.Context, j Job) error {
		attempts++
		if attempts == 1 {
			return errors.New("temporary")
		}
		b.mu.Lock()
		b.due[j] = time.Time{}
		b.mu.Unlock()
		close(fired)
		return nil
	}
	s := NewScheduler(b)
	s.retryBase = 5 * time.Millisecond
	for i := 0; i < 100; i++ {
		s.Wake()
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); s.Run(ctx) }()
	await(t, fired)
	cancel()
	await(t, done)
	if attempts != 2 {
		t.Fatalf("attempts = %d", attempts)
	}
}

func TestSchedulerIdleWaitsForReconciliation(t *testing.T) {
	b := &schedulerBackend{}
	b.run = func(context.Context, Job) error { return nil }
	s := NewScheduler(b)
	s.reconcile = 30 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	s.Run(ctx)
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.calls < 2 || b.calls > 5 {
		t.Fatalf("idle queries = %d", b.calls)
	}
}
