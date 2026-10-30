package repository

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type receiptDB struct {
	DBTX
	row  pgx.Row
	args []any
}

func (d *receiptDB) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	d.args = args
	return d.row
}
func (d *receiptDB) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	d.args = args
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

type receiptRow struct {
	status int
	err    error
}

func (r receiptRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	*dest[0].(*string) = "request-hash"
	*dest[1].(*int) = r.status
	*dest[2].(*[]byte) = []byte(`{"id":"task"}`)
	return nil
}

func TestReceiptsPreserveLegacyStatusAndAccountScope(t *testing.T) {
	for _, tc := range []struct {
		status  int
		outcome models.Outcome
	}{{200, models.Updated}, {201, models.Created}} {
		db := &receiptDB{row: receiptRow{status: tc.status}}
		hash, outcome, body, err := ReadReceipt(context.Background(), db, "account-a", "request-key")
		if err != nil || hash != "request-hash" || outcome != tc.outcome || string(body) != `{"id":"task"}` {
			t.Fatalf("read: %q %v %s %v", hash, outcome, body, err)
		}
		if !reflect.DeepEqual(db.args, []any{"account-a", "request-key"}) {
			t.Fatalf("account scope lost: %#v", db.args)
		}
		now := time.Now()
		if _, err = InsertReceipt(context.Background(), db, "account-a", "request-key", hash, outcome, body, now); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(db.args, []any{"account-a", "request-key", hash, tc.status, body, now}) {
			t.Fatalf("receipt changed: %#v", db.args)
		}
	}
}
func TestReceiptMissingIsNotAReplay(t *testing.T) {
	db := &receiptDB{row: receiptRow{err: pgx.ErrNoRows}}
	_, _, _, err := ReadReceipt(context.Background(), db, "account-a", "request-key")
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("missing receipt: %v", err)
	}
}
