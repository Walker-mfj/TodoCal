package services

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type GroupInput = models.GroupInput
type Group = models.Group

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validateGroup(in *GroupInput) error {
	in.Name = strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(in.Name); n < 1 || n > 100 {
		return Invalid("Use a group name of 1–100 characters")
	}
	if !colorPattern.MatchString(in.Color) {
		return Invalid("Use a six-digit hex color")
	}
	return nil
}
func getGroup(ctx context.Context, tx pgx.Tx, id, user string) (Group, error) {
	var g Group
	parsed, e := uuid.Parse(id)
	if e != nil {
		return g, Missing()
	}
	id = parsed.String()
	e = repository.ReadGroup(ctx, tx, user, id, &g)
	if errors.Is(e, pgx.ErrNoRows) {
		e = Missing()
	}
	return g, e
}

func ListGroupsCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	items, e := repository.ListGroups(ctx, tx, p.ID)
	if e != nil {
		return nil, e
	}
	return map[string]any{"items": items}, nil
}
func CreateGroupCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.Group()
	if e != nil {
		return nil, 0, e
	}
	if e := validateGroup(&in); e != nil {
		return nil, 0, e
	}
	g := Group{GroupInput: in, ID: uuid.NewString(), Revision: 1}
	_, e = repository.InsertGroup(ctx, tx, p.ID, g.ID, g.Name, g.Color)
	return g, models.Created, e
}
func EditGroupCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	g, e := getGroup(ctx, tx, params.ID, p.ID)
	if e != nil {
		return nil, 0, e
	}
	rev, e := input.Revision()
	if e != nil {
		return nil, 0, e
	}
	if rev != g.Revision {
		return nil, 0, Conflict()
	}
	in, e := input.GroupPatch(g.GroupInput)
	if e != nil {
		return nil, 0, e
	}
	if e = validateGroup(&in); e != nil {
		return nil, 0, e
	}
	g.GroupInput = in
	g.Revision++
	_, e = repository.UpdateGroup(ctx, tx, p.ID, g.ID, g.Name, g.Color)
	return g, models.Updated, e
}
func DeleteGroupCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	in, e := input.RevisionCommand()
	if e != nil {
		return nil, 0, e
	}
	if in.ExpectedRevision < 1 {
		return nil, 0, Invalid("Provide expectedRevision")
	}
	g, e := getGroup(ctx, tx, params.ID, p.ID)
	if e != nil {
		return nil, 0, e
	}
	if g.Revision != in.ExpectedRevision {
		return nil, 0, Conflict()
	}
	affected, e := repository.ListGroupTasks(ctx, tx, p.ID, g.ID)
	if e != nil {
		return nil, 0, e
	}
	// Clear even soft-deleted tasks to satisfy the composite FK; historical events retain their original state.
	_, e = repository.UnlinkGroupTasks(ctx, tx, p.ID, g.ID, now)
	if e != nil {
		return nil, 0, e
	}
	for _, old := range affected {
		next := old
		next.GroupID = nil
		next.Revision++
		next.UpdatedAt = now
		if e = Event(ctx, tx, p.ID, zone, "group_cleared", now, &old, next); e != nil {
			return nil, 0, e
		}
	}
	_, e = repository.UnlinkGroupSeries(ctx, tx, p.ID, g.ID)
	if e != nil {
		return nil, 0, e
	}
	_, e = repository.DeleteGroup(ctx, tx, p.ID, g.ID)
	return map[string]bool{"ok": true}, models.Updated, e
}
