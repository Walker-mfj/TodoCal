package workers

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// accountTurn rotates through due accounts in stable user-ID order. One lane
// owns each cursor; Next never reads it. Account failures retain their durable
// work but advance this process-local cursor BEFORE execution, including when
// the transaction times out. They get another turn after the cursor wraps.
type accountTurn struct{ after string }

func (t *accountTurn) run(ctx context.Context, selectNext func(context.Context, string) (string, error), execute func(context.Context, string) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	user, err := selectNext(ctx, t.after)
	if errors.Is(err, pgx.ErrNoRows) && t.after != "" {
		user, err = selectNext(ctx, "")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	t.after = user
	return execute(ctx, user)
}
