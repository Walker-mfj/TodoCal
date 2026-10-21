package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"focuscalendar/internal/planning"
	"focuscalendar/internal/tasks"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"strings"
	"time"
)

type operation func(pgx.Tx, Principal, string, time.Time, []byte) (any, int, error)

func domainError(w http.ResponseWriter, err error) {
	var f *tasks.Fault
	if errors.As(err, &f) {
		fail(w, f.Status, f.Code, f.Message)
	} else {
		internal(w, err)
	}
}
func parseInput(raw []byte, v any) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return tasks.Invalid("Send a JSON object")
	}
	for key, value := range fields {
		if string(value) != "null" {
			continue
		}
		switch key {
		case "endDate", "groupId", "scheduledDate", "startTime", "endTime", "deadline", "estimatedPomodoros":
		default:
			return tasks.Invalid("Field cannot be null: " + key)
		}
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if len(raw) == 0 || string(raw) == "null" {
		return tasks.Invalid("Send a JSON object")
	}
	if e := d.Decode(v); e != nil {
		return tasks.Invalid("Check the request fields")
	}
	if e := d.Decode(new(any)); !errors.Is(e, io.EOF) {
		return tasks.Invalid("Send one JSON object")
	}
	return nil
}
func (s *Server) mutate(w http.ResponseWriter, r *http.Request, op operation) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if len(key) < 16 || len(key) > 128 || strings.TrimSpace(key) != key {
		fail(w, 422, "idempotency_key", "Provide an Idempotency-Key of 16–128 characters")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16384))
	if err != nil {
		fail(w, 422, "validation", "Request body is too large")
		return
	}
	hash := tokenHash(r.Method + "\n" + r.URL.RequestURI() + "\n" + string(raw))
	var body []byte
	var status int
	err = planning.WithTx(r.Context(), s.pool, p.ID, s.now, func(tx pgx.Tx, zone string, now time.Time) error {
		var valid bool
		if e := tx.QueryRow(r.Context(), `SELECT revoked_at IS NULL AND expires_at>$2 FROM auth_sessions WHERE id=$1 AND user_id=$3`, p.SessionID, now, p.ID).Scan(&valid); e != nil {
			return e
		}
		if !valid {
			return &tasks.Fault{Status: 401, Code: "unauthenticated", Message: "Please sign in"}
		}
		var previous string
		e := tx.QueryRow(r.Context(), `SELECT request_hash,response_status,response_body FROM mutation_receipts WHERE user_id=$1 AND idempotency_key=$2`, p.ID, key).Scan(&previous, &status, &body)
		if e == nil {
			if previous != hash {
				return &tasks.Fault{Status: 409, Code: "idempotency_conflict", Message: "This request key was already used for different input"}
			}
			return nil
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		// History is settled by planning.WithTx before this command executes.
		out, code, e := op(tx, p, zone, now, raw)
		if e != nil {
			return e
		}
		body, e = json.Marshal(out)
		if e != nil {
			return e
		}
		status = code
		_, e = tx.Exec(r.Context(), `INSERT INTO mutation_receipts(user_id,idempotency_key,request_hash,response_status,response_body,created_at) VALUES($1,$2,$3,$4,$5,$6)`, p.ID, key, hash, status, body, now)
		return e
	})
	if err != nil {
		domainError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(append(body, '\n'))
}
func (s *Server) view(w http.ResponseWriter, r *http.Request, op func(pgx.Tx, Principal, string, time.Time) (any, error)) {
	p, ok := s.authenticate(w, r)
	if !ok {
		return
	}
	var out any
	err := planning.WithTx(r.Context(), s.pool, p.ID, s.now, func(tx pgx.Tx, zone string, now time.Time) error {
		var e error
		out, e = op(tx, p, zone, now)
		return e
	})
	if err != nil {
		domainError(w, err)
		return
	}
	writeJSON(w, 200, out)
}
func expected(raw []byte) (int64, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return 0, tasks.Invalid("Send a JSON object")
	}
	var n int64
	if err := json.Unmarshal(fields["expectedRevision"], &n); err != nil || n < 1 {
		return 0, tasks.Invalid("Provide expectedRevision")
	}
	return n, nil
}

// mergePatch preserves omitted editable properties; explicit null clears nullable fields.
func mergePatch(raw []byte, current any, target any) error {
	var patch map[string]json.RawMessage
	if err := json.Unmarshal(raw, &patch); err != nil {
		return tasks.Invalid("Send a JSON object")
	}
	delete(patch, "expectedRevision")
	old, _ := json.Marshal(current)
	var merged map[string]json.RawMessage
	json.Unmarshal(old, &merged)
	for k, v := range patch {
		if _, ok := merged[k]; !ok {
			return tasks.Invalid("Unknown editable field: " + k)
		}
		merged[k] = v
	}
	combined, _ := json.Marshal(merged)
	return parseInput(combined, target)
}
