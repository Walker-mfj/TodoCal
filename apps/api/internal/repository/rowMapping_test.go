package repository

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

type cursor struct {
	pgx.Rows
	remaining            int
	closed               bool
	scanErr, terminalErr error
}

func (c *cursor) Next() bool {
	if c.remaining == 0 {
		return false
	}
	c.remaining--
	return true
}
func (c *cursor) Scan(dest ...any) error {
	if c.scanErr != nil {
		return c.scanErr
	}
	*dest[0].(*string) = "row"
	return nil
}
func (c *cursor) Close()     { c.closed = true }
func (c *cursor) Err() error { return c.terminalErr }
func TestCollectClosesCursorOnSuccessAndFailure(t *testing.T) {
	failure := errors.New("storage failure")
	for _, tc := range []struct {
		name string
		rows cursor
		want error
	}{
		{"success", cursor{remaining: 1}, nil},
		{"scan failure", cursor{remaining: 1, scanErr: failure}, failure},
		{"terminal failure", cursor{terminalErr: failure}, failure},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := collect(&tc.rows, scanString)
			if !errors.Is(err, tc.want) {
				t.Fatalf("error: %v", err)
			}
			if !tc.rows.closed {
				t.Fatal("cursor left open on shared transaction")
			}
		})
	}
}
func TestEmptyCollectionSerializesAsArray(t *testing.T) {
	rows := &cursor{}
	values, err := collect(rows, scanString)
	if err != nil || values == nil || len(values) != 0 {
		t.Fatalf("empty collection: %#v %v", values, err)
	}
}
