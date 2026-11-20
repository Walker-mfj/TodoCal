package workers

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestHostLeaderWaitsUntilOldSchedulerDrains(t *testing.T) {
	path := filepath.Join(t.TempDir(), "leader.lock")
	if err := os.WriteFile(path, nil, 0o444); err != nil {
		t.Fatal(err)
	}
	first, err := OpenHostLeaderLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = first.Close() }()
	second, err := OpenHostLeaderLock(path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = second.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	oldCtx, cancelOld := context.WithCancel(ctx)
	defer cancelOld()
	entered, draining, release, next := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	oldDone, newDone := make(chan error, 1), make(chan error, 1)
	go func() {
		oldDone <- RunHostLeader(oldCtx, first, func(runCtx context.Context) {
			close(entered)
			<-runCtx.Done()
			close(draining)
			<-release
		})
	}()
	await(t, entered)
	go func() {
		newDone <- RunHostLeader(ctx, second, func(context.Context) { close(next) })
	}()
	cancelOld()
	await(t, draining)
	select {
	case <-next:
		close(release)
		t.Fatal("new scheduler ran before old drained")
	case <-time.After(300 * time.Millisecond):
	}
	close(release)
	await(t, next)
	if err := <-oldDone; err != nil {
		t.Fatal(err)
	}
	if err := <-newDone; err != nil {
		t.Fatal(err)
	}
}

func TestMissingHostLeaderLockFailsClosed(t *testing.T) {
	if file, err := OpenHostLeaderLock(filepath.Join(t.TempDir(), "missing")); err == nil {
		_ = file.Close()
		t.Fatal("unexpectedly created a lock")
	}
}
