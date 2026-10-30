package services

import (
	"context"
	"strconv"
	"time"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func CreateTaskCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.Task()
	if e != nil {
		return nil, 0, e
	}
	t, e := CreateTask(ctx, tx, p.ID, zone, now, in)
	return t, models.Created, e
}
func GetTaskCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	return GetTask(ctx, tx, p.ID, params.ID)
}
func EditTaskCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	old, e := GetTask(ctx, tx, p.ID, params.ID)
	if e != nil {
		return nil, 0, e
	}
	revision, e := input.Revision()
	if e != nil {
		return nil, 0, e
	}
	if revision != old.Revision {
		return nil, 0, Conflict()
	}
	patch, e := input.TaskPatch(old.TaskInput)
	if e != nil {
		return nil, 0, e
	}
	in, scope, seriesRevision, fields := patch.Task, patch.Scope, patch.SeriesRevision, patch.Fields
	if scope == "all" {
		if seriesRevision < 1 {
			return nil, 0, Invalid("Provide expectedSeriesRevision")
		}
		t, err := UpdateFromTask(ctx, tx, p.ID, zone, now, old, in, seriesRevision, fields)
		return t, models.Updated, err
	}
	t, e := UpdateTask(ctx, tx, p.ID, zone, now, old, in)
	return t, models.Updated, e
}
func CompleteTaskCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.Completion()
	if e != nil {
		return nil, 0, e
	}
	if in.Complete == nil || in.ExpectedRevision < 1 {
		return nil, 0, Invalid("Provide complete and expectedRevision")
	}
	old, e := GetTask(ctx, tx, p.ID, params.ID)
	if e != nil {
		return nil, 0, e
	}
	if old.Revision != in.ExpectedRevision {
		return nil, 0, Conflict()
	}
	t, e := CompleteTask(ctx, tx, p.ID, zone, now, old, *in.Complete, in.MoveToToday, in.CompletedAt)
	return t, models.Updated, e
}
func DeleteTaskCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.RevisionCommand()
	if e != nil {
		return nil, 0, e
	}
	if in.ExpectedRevision < 1 {
		return nil, 0, Invalid("Provide expectedRevision")
	}
	old, e := GetTask(ctx, tx, p.ID, params.ID)
	if e != nil {
		return nil, 0, e
	}
	if old.Revision != in.ExpectedRevision {
		return nil, 0, Conflict()
	}
	return map[string]any{"ok": true, "revision": old.Revision + 1}, models.Updated, DeleteTask(ctx, tx, p.ID, zone, now, old)
}
func ListTasksCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	q := params.Query
	limit := 50
	if v := q.Get("limit"); v != "" {
		n, e := strconv.Atoi(v)
		if e != nil || n < 1 || n > 100 {
			return nil, Invalid("Limit must be 1–100")
		}
		limit = n
	}
	cursor := q.Get("cursor")
	if cursor != "" {
		parsed, e := uuid.Parse(cursor)
		if e != nil {
			return nil, Invalid("Invalid cursor")
		}
		cursor = parsed.String()
	}
	priority, status, group, view := q.Get("priority"), q.Get("status"), q.Get("groupId"), q.Get("view")
	if priority != "" && priority != "low" && priority != "medium" && priority != "high" {
		return nil, Invalid("Invalid priority filter")
	}
	if status != "" && status != "complete" && status != "incomplete" {
		return nil, Invalid("Invalid status filter")
	}
	if group != "" && group != "none" {
		parsed, e := uuid.Parse(group)
		if e != nil {
			return nil, Invalid("Invalid group filter")
		}
		group = parsed.String()
	}
	switch view {
	case "", "all", "today", "upcoming", "overdue", "unscheduled", "previously-unfinished":
	default:
		return nil, Invalid("Invalid task view")
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return nil, e
	}
	today := now.In(loc).Format("2006-01-02")
	items, e := repository.ListTasks(ctx, tx, p.ID, cursor, q.Get("search"), priority, status, group, view, today, now, limit+1)
	if e != nil {
		return nil, e
	}
	var next *string
	if len(items) > limit {
		v := items[limit-1].ID
		next = &v
		items = items[:limit]
	}
	return map[string]any{"items": items, "nextCursor": next}, nil
}
func RestoreTaskCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	revision, e := input.Revision()
	if e != nil {
		return nil, 0, e
	}
	t, e := RestoreTask(ctx, tx, p.ID, zone, params.ID, now, revision)
	return t, models.Updated, e
}
func RestoreSeriesCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	revision, e := input.Revision()
	if e != nil {
		return nil, 0, e
	}
	sr, e := RestoreStop(ctx, tx, p.ID, zone, params.ID, now, revision)
	return sr, models.Updated, e
}
