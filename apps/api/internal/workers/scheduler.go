package workers

import (
	"context"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"
)

type Job int

const (
	Focus Job = iota
	Dispatch
	Horizon
	Cleanup
	jobCount
)

type Deadlines [jobCount]time.Time

type ScheduleBackend interface {
	Next(context.Context) (Deadlines, error)
	Run(context.Context, Job) error
}

// Scheduler has one coordinator and at most one bounded worker per lane.
// Focus has its own lane so cleanup and Web Push cannot monopolize settlement.
type Scheduler struct {
	backend              ScheduleBackend
	wake                 chan struct{}
	reconcile, retryBase time.Duration
}

func NewScheduler(backend ScheduleBackend) *Scheduler {
	return &Scheduler{backend: backend, wake: make(chan struct{}, 1), reconcile: 15 * time.Minute, retryBase: time.Second}
}
func (s *Scheduler) Wake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

type jobResult struct {
	job Job
	err error
}

func (s *Scheduler) Run(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	var wg sync.WaitGroup
	defer func() { cancel(); wg.Wait() }()
	// Completion messages are never coalesced or dropped: each clears ownership.
	results := make(chan jobResult, jobCount)
	timer := time.NewTimer(0)
	defer timer.Stop()
	var due Deadlines
	var busy [jobCount]bool
	var retryAt Deadlines
	var failures [jobCount]int
	var queryRetry time.Time
	queryFailures := 0
	refresh := true
	reconcileAt := time.Now().Add(s.reconcile)
	for ctx.Err() == nil {
		now := time.Now()
		if refresh && !now.Before(queryRetry) {
			queryCtx, stop := context.WithTimeout(ctx, 2*time.Second)
			next, err := s.backend.Next(queryCtx)
			stop()
			if err != nil {
				queryFailures++
				queryRetry = time.Now().Add(s.backoff(queryFailures))
				slog.Warn("notification scheduler operation failed", "operation", "next_due", "attempt", queryFailures)
			} else {
				due = next
				refresh = false
				queryFailures = 0
				queryRetry = time.Time{}
			}
		}
		now = time.Now()
		for j := Job(0); j < jobCount; j++ {
			if busy[j] || due[j].IsZero() || due[j].After(now) || retryAt[j].After(now) {
				continue
			}
			busy[j] = true
			wg.Add(1)
			go func(job Job) {
				defer wg.Done()
				budget := 2 * time.Second
				if job == Dispatch {
					budget = 20 * time.Second
				}
				workCtx, stop := context.WithTimeout(ctx, budget)
				err := s.backend.Run(workCtx, job)
				stop()
				results <- jobResult{job, err}
			}(j)
		}
		// Rearm immediately after handoff, ignoring only occupied lanes. This is
		// essential when Focus ends while a provider call is still in progress.
		next := reconcileAt
		if refresh && !queryRetry.IsZero() && queryRetry.Before(next) {
			next = queryRetry
		}
		for j := Job(0); j < jobCount; j++ {
			if busy[j] || due[j].IsZero() {
				continue
			}
			at := due[j]
			if retryAt[j].After(at) {
				at = retryAt[j]
			}
			if at.Before(next) {
				next = at
			}
		}
		timer.Reset(max(0, time.Until(next)))
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
			refresh = true
		case result := <-results:
			j := result.job
			busy[j] = false
			if result.err != nil {
				failures[j]++
				retryAt[j] = time.Now().Add(s.backoff(failures[j]))
				// Retain work even if a concurrent query no longer reports this deadline.
				due[j] = time.Now()
				slog.Warn("notification scheduler operation failed", "lane", int(j), "attempt", failures[j])
			} else {
				failures[j] = 0
				retryAt[j] = time.Time{}
				due[j] = time.Time{}
			}
			refresh = true
		case <-timer.C:
			if !time.Now().Before(reconcileAt) {
				refresh = true
				reconcileAt = time.Now().Add(s.reconcile)
			}
		}
	}
}

func (s *Scheduler) backoff(attempt int) time.Duration {
	base := min(s.retryBase*time.Duration(1<<min(attempt-1, 6)), time.Minute)
	return base + time.Duration(rand.Int64N(max(1, int64(base/4))))
}
