package database

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

type commitTx struct {
	pgx.Tx
	err       error
	committed bool
}

func (t *commitTx) Commit(context.Context) error { t.committed = t.err == nil; return t.err }

func TestScheduleWakeOnlyAfterSuccessfulCommit(t *testing.T) {
	for _, failed := range []bool{false, true} {
		tx := &commitTx{}
		if failed {
			tx.err = errors.New("commit failed")
		}
		calls := 0
		ctx := WithScheduleWake(context.Background(), func() {
			if !tx.committed {
				t.Fatal("wake before commit")
			}
			calls++
		})
		err := Commit(ctx, tx)
		if failed && (err == nil || calls != 0) {
			t.Fatal("failed commit published wake")
		}
		if !failed && (err != nil || calls != 1) {
			t.Fatal("successful commit missing wake")
		}
	}
}

func TestScheduleWakeWithoutPublisher(t *testing.T) {
	if err := Commit(context.Background(), &commitTx{}); err != nil {
		t.Fatal(err)
	}
}
