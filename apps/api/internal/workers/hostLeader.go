package workers

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
)

// OpenHostLeaderLock opens a pre-created, shared local inode. Never create,
// unlink or replace this file while any scheduler process may be alive.
func OpenHostLeaderLock(path string) (*os.File, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		return nil, errors.New("scheduler lock must be a regular file")
	}
	return file, nil
}

// RunHostLeader holds the kernel lock until Run and all of its lanes finish.
// Losing a DB connection cannot release it. This is single-host leadership,
// not a distributed lock across machines. Linux local filesystem is required.
func RunHostLeader(ctx context.Context, file *os.File, run func(context.Context)) error {
	for ctx.Err() == nil {
		err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
		if err == nil {
			defer func() { _ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN) }()
			if ctx.Err() == nil {
				run(ctx)
			}
			return nil
		}
		if !errors.Is(err, syscall.EWOULDBLOCK) && !errors.Is(err, syscall.EAGAIN) && !errors.Is(err, syscall.EINTR) {
			return err
		}
		timer := time.NewTimer(200 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
	return nil
}

// ListenScheduleWake uses an independent connection, not a pool slot. The
// initial wake after LISTEN closes the startup/reconnect notification gap.
// Reconciliation remains a fallback, not the normal cross-process wake path.
func ListenScheduleWake(ctx context.Context, config *pgx.ConnConfig, wake func()) {
	for ctx.Err() == nil {
		connectCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		conn, err := pgx.ConnectConfig(connectCtx, config.Copy())
		if err == nil {
			_, err = conn.Exec(connectCtx, "LISTEN todocal_schedule_wake")
		}
		cancel()
		if err == nil {
			wake()
			for ctx.Err() == nil {
				if _, err = conn.WaitForNotification(ctx); err != nil {
					break
				}
				wake()
			}
		}
		if conn != nil {
			closeCtx, stop := context.WithTimeout(context.Background(), 2*time.Second)
			_ = conn.Close(closeCtx)
			stop()
		}
		if ctx.Err() != nil {
			return
		}
		slog.Warn("scheduler notification listener reconnecting")
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
