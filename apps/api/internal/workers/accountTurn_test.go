package workers

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestAccountTurnFailureDoesNotStarveOtherAccounts(t *testing.T) {
	for _, failure := range []error{errors.New("materialization failed"), context.DeadlineExceeded} {
		t.Run(failure.Error(), func(t *testing.T) {
			var turn accountTurn
			pending := map[string]bool{"a": true, "b": true, "c": true}
			selectNext := func(_ context.Context, after string) (string, error) {
				for _, user := range []string{"a", "b", "c"} {
					if user > after && pending[user] {
						return user, nil
					}
				}
				return "", pgx.ErrNoRows
			}
			var attempted []string
			execute := func(_ context.Context, user string) error {
				attempted = append(attempted, user)
				if user == "a" {
					return failure
				}
				delete(pending, user)
				return nil
			}
			for i, wantErr := range []error{failure, nil, nil, failure, failure} {
				if err := turn.run(context.Background(), selectNext, execute); !errors.Is(err, wantErr) {
					t.Fatalf("turn %d: %v", i, err)
				}
			}
			if got := strings.Join(attempted, ""); got != "abcaa" {
				t.Fatalf("attempt order %s; expected abcaa", got)
			}
			if len(pending) != 1 || !pending["a"] {
				t.Fatal("unfinished account was lost")
			}
		})
	}
}

func TestAccountTurnSelectionErrorAndIndependentLanes(t *testing.T) {
	var focus, horizon accountTurn
	failure := errors.New("database offline")
	executed := false
	execute := func(context.Context, string) error { executed = true; return nil }
	if err := focus.run(context.Background(), func(context.Context, string) (string, error) { return "", failure }, execute); !errors.Is(err, failure) || executed {
		t.Fatal("selection error swallowed")
	}
	selectFirst := func(_ context.Context, after string) (string, error) {
		if after != "" {
			t.Fatalf("unexpected shared/advanced cursor %q", after)
		}
		return "a", nil
	}
	if err := focus.run(context.Background(), selectFirst, execute); err != nil {
		t.Fatal(err)
	}
	if err := horizon.run(context.Background(), selectFirst, execute); err != nil {
		t.Fatal(err)
	}
}

func TestAccountTurnEmptyAndCanceled(t *testing.T) {
	var turn accountTurn
	execute := func(context.Context, string) error { t.Fatal("unexpected work"); return nil }
	if err := turn.run(context.Background(), func(context.Context, string) (string, error) { return "", pgx.ErrNoRows }, execute); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := turn.run(ctx, func(context.Context, string) (string, error) { t.Fatal("query after cancellation"); return "", nil }, execute); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
