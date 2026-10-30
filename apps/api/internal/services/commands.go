package services

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Operation func(context.Context, pgx.Tx, Principal, string, time.Time, CommandInput, Parameters) (any, models.Outcome, error)
type Query func(context.Context, pgx.Tx, Principal, string, time.Time, CommandInput, Parameters) (any, error)

// Execute keeps settlement, session revalidation, the mutation and its receipt in one account transaction.
func Execute(ctx context.Context, pool *pgxpool.Pool, clock func() time.Time, p Principal, key, hash string, input CommandInput, params Parameters, op Operation) ([]byte, models.Outcome, error) {
	var body []byte
	var status models.Outcome
	err := WithTx(ctx, pool, p.ID, clock, func(tx pgx.Tx, zone string, now time.Time) error {
		var valid bool
		if e := repository.ValidateOwnedSession(ctx, tx, p.SessionID, now, p.ID, &valid); e != nil {
			return e
		}
		if !valid {
			return &Fault{Code: "unauthenticated", Message: "Please sign in"}
		}
		var previous string
		var e error
		previous, status, body, e = repository.ReadReceipt(ctx, tx, p.ID, key)
		if e == nil {
			if previous != hash {
				return &Fault{Code: "idempotency_conflict", Message: "This request key was already used for different input"}
			}
			return nil
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		// History is settled by WithTx before this command executes.
		out, code, e := op(ctx, tx, p, zone, now, input, params)
		if e != nil {
			return e
		}
		body, e = json.Marshal(out)
		if e != nil {
			return e
		}
		status = code
		_, e = repository.InsertReceipt(ctx, tx, p.ID, key, hash, status, body, now)
		return e
	})
	return body, status, err
}
func View(ctx context.Context, pool *pgxpool.Pool, clock func() time.Time, p Principal, params Parameters, op Query) (any, error) {
	var out any
	err := WithTx(ctx, pool, p.ID, clock, func(tx pgx.Tx, zone string, now time.Time) error {
		var e error
		out, e = op(ctx, tx, p, zone, now, nil, params)
		return e
	})
	return out, err
}
