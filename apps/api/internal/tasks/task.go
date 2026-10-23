// Package tasks implements owned task mutations inside an account transaction.
package tasks

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"strings"
	"time"
	"unicode/utf8"
)

type Fault struct {
	Status        int
	Code, Message string
}

func (e *Fault) Error() string     { return e.Message }
func Invalid(message string) error { return &Fault{422, "validation", message} }
func Missing() error               { return &Fault{404, "not_found", "Resource not found"} }
func Conflict() error {
	return &Fault{409, "revision_conflict", "This item changed. Refresh and try again."}
}

type Input struct {
	Title              string     `json:"title"`
	Description        string     `json:"description"`
	GroupID            *string    `json:"groupId"`
	Priority           string     `json:"priority"`
	ScheduledDate      *string    `json:"scheduledDate"`
	StartTime          *string    `json:"startTime"`
	EndTime            *string    `json:"endTime"`
	Deadline           *time.Time `json:"deadline"`
	EstimatedPomodoros *int       `json:"estimatedPomodoros"`
}
type Task struct {
	Input
	ID                     string    `json:"id"`
	Status                 string    `json:"status"`
	Revision               int64     `json:"revision"`
	CreatedAt              time.Time `json:"createdAt"`
	UpdatedAt              time.Time `json:"updatedAt"`
	SeriesID               *string   `json:"seriesId"`
	OriginalOccurrenceDate *string   `json:"originalOccurrenceDate"`
}

const Columns = `id::text,title,description,group_id::text,priority,scheduled_date::text,to_char(start_time,'HH24:MI'),to_char(end_time,'HH24:MI'),deadline,estimated_pomodoros,status,revision,created_at,updated_at,series_id::text,original_occurrence_date::text`

func Scan(row pgx.Row) (Task, error) {
	var t Task
	err := row.Scan(&t.ID, &t.Title, &t.Description, &t.GroupID, &t.Priority, &t.ScheduledDate, &t.StartTime, &t.EndTime, &t.Deadline, &t.EstimatedPomodoros, &t.Status, &t.Revision, &t.CreatedAt, &t.UpdatedAt, &t.SeriesID, &t.OriginalOccurrenceDate)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, Missing()
	}
	t.CreatedAt = t.CreatedAt.UTC()
	t.UpdatedAt = t.UpdatedAt.UTC()
	if t.Deadline != nil {
		v := t.Deadline.UTC()
		t.Deadline = &v
	}
	return t, err
}
func Get(ctx context.Context, tx pgx.Tx, user, id string) (Task, error) {
	if _, err := uuid.Parse(id); err != nil {
		return Task{}, Missing()
	}
	return Scan(tx.QueryRow(ctx, `SELECT `+Columns+` FROM tasks WHERE user_id=$1 AND id=$2 AND deleted_at IS NULL`, user, id))
}
func Validate(in *Input, zone string, now time.Time, previous *Task) error {
	in.Title = strings.TrimSpace(in.Title)
	if n := utf8.RuneCountInString(in.Title); n == 0 || n > 300 {
		return Invalid("Use a title of 1–300 characters")
	}
	if utf8.RuneCountInString(in.Description) > 10000 {
		return Invalid("Description must be at most 10000 characters")
	}
	if in.Priority == "" {
		in.Priority = "medium"
	}
	if in.Priority != "low" && in.Priority != "medium" && in.Priority != "high" {
		return Invalid("Choose low, medium, or high priority")
	}
	if in.EstimatedPomodoros != nil && (*in.EstimatedPomodoros < 1 || *in.EstimatedPomodoros > 2147483647) {
		return Invalid("Estimated Pomodoros must be a positive integer")
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	if in.ScheduledDate != nil {
		d, e := time.Parse("2006-01-02", *in.ScheduledDate)
		if e != nil || d.Year() < 1 || d.Format("2006-01-02") != *in.ScheduledDate {
			return Invalid("Use a valid scheduled date")
		}
		unchanged := previous != nil && previous.ScheduledDate != nil && *previous.ScheduledDate == *in.ScheduledDate
		if *in.ScheduledDate < now.In(loc).Format("2006-01-02") && !unchanged {
			return Invalid("Schedule on today or a future date")
		}
	}
	if (in.StartTime == nil) != (in.EndTime == nil) {
		return Invalid("Provide both start and end times")
	}
	if in.StartTime != nil {
		if in.ScheduledDate == nil {
			return Invalid("Times require a scheduled date")
		}
		for _, v := range []string{*in.StartTime, *in.EndTime} {
			parsed, e := time.Parse("15:04", v)
			if e != nil || parsed.Format("15:04") != v {
				return Invalid("Use HH:mm times")
			}
			stamp := *in.ScheduledDate + " " + v
			local, e := time.ParseInLocation("2006-01-02 15:04", stamp, loc)
			if e != nil || local.Format("2006-01-02 15:04") != stamp {
				return Invalid("This local time does not exist in your time zone")
			}
		}
		if *in.EndTime <= *in.StartTime {
			return Invalid("End time must be after start time on the same day")
		}
	}
	if in.Deadline != nil {
		if in.Deadline.Year() < 1 || in.Deadline.Year() > 9999 {
			return Invalid("Use a valid deadline")
		}
		v := in.Deadline.UTC()
		in.Deadline = &v
	}
	return nil
}
func CheckGroup(ctx context.Context, tx pgx.Tx, user string, id *string) error {
	if id == nil {
		return nil
	}
	if _, err := uuid.Parse(*id); err != nil {
		return Missing()
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM groups WHERE user_id=$1 AND id=$2)`, user, *id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return Missing()
	}
	return nil
}
func Event(ctx context.Context, tx pgx.Tx, user, zone, kind string, now time.Time, before *Task, after Task) error {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return err
	}
	var old []byte
	if before != nil {
		old, err = json.Marshal(before)
		if err != nil {
			return err
		}
	}
	next, err := json.Marshal(after)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO task_events(user_id,id,task_id,kind,occurred_at,local_date,timezone,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, user, uuid.NewString(), after.ID, kind, now, now.In(loc).Format("2006-01-02"), zone, old, next)
	return err
}
func Create(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, in Input) (Task, error) {
	if err := Validate(&in, zone, now, nil); err != nil {
		return Task{}, err
	}
	if err := CheckGroup(ctx, tx, user, in.GroupID); err != nil {
		return Task{}, err
	}
	if err := EditableDate(ctx, tx, user, in.ScheduledDate); err != nil {
		return Task{}, err
	}
	t, err := Scan(tx.QueryRow(ctx, `INSERT INTO tasks(user_id,id,title,description,group_id,priority,scheduled_date,start_time,end_time,deadline,estimated_pomodoros,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) RETURNING `+Columns, user, uuid.NewString(), in.Title, in.Description, in.GroupID, in.Priority, in.ScheduledDate, in.StartTime, in.EndTime, in.Deadline, in.EstimatedPomodoros, now))
	if err != nil {
		return t, err
	}
	return t, Event(ctx, tx, user, zone, "created", now, nil, t)
}
func Update(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, old Task, in Input) (Task, error) {
	if err := Validate(&in, zone, now, &old); err != nil {
		return Task{}, err
	}
	if err := CheckGroup(ctx, tx, user, in.GroupID); err != nil {
		return Task{}, err
	}
	if !sameDate(old.ScheduledDate, in.ScheduledDate) {
		if err := EditableDate(ctx, tx, user, in.ScheduledDate); err != nil {
			return Task{}, err
		}
	}
	t, err := Scan(tx.QueryRow(ctx, `UPDATE tasks SET title=$3,description=$4,group_id=$5,priority=$6,scheduled_date=$7,start_time=$8,end_time=$9,deadline=$10,estimated_pomodoros=$11,revision=revision+1,updated_at=$12 WHERE user_id=$1 AND id=$2 RETURNING `+Columns, user, old.ID, in.Title, in.Description, in.GroupID, in.Priority, in.ScheduledDate, in.StartTime, in.EndTime, in.Deadline, in.EstimatedPomodoros, now))
	if err != nil {
		return t, err
	}
	if !sameDate(old.ScheduledDate, t.ScheduledDate) {
		if err = Exception(ctx, tx, user, t, "moved", now); err != nil {
			return t, err
		}
	}
	return t, Event(ctx, tx, user, zone, "updated", now, &old, t)
}
func Complete(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, old Task, complete, move bool) (Task, error) {
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return Task{}, err
	}
	today := now.In(loc).Format("2006-01-02")
	date := old.ScheduledDate
	if complete && date != nil && *date > today {
		if !move {
			return Task{}, Invalid("Move this future task to today before completing it")
		}
		date = &today
	}
	status, kind := "incomplete", "reopened"
	if complete {
		status, kind = "complete", "completed"
	}
	if status == old.Status {
		return old, nil
	}
	in := old.Input
	in.ScheduledDate = date
	if err = Validate(&in, zone, now, &old); err != nil {
		return Task{}, err
	}
	if !sameDate(old.ScheduledDate, date) {
		if err = EditableDate(ctx, tx, user, date); err != nil {
			return Task{}, err
		}
	}
	t, err := Scan(tx.QueryRow(ctx, `UPDATE tasks SET status=$3,scheduled_date=$4,revision=revision+1,updated_at=$5 WHERE user_id=$1 AND id=$2 RETURNING `+Columns, user, old.ID, status, date, now))
	if err != nil {
		return t, err
	}
	if !complete {
		_, err = tx.Exec(ctx, `UPDATE task_events SET invalidated_at=$3 WHERE user_id=$1 AND task_id=$2 AND kind='completed' AND local_date=$4 AND invalidated_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$4::date)
 AND NOT EXISTS(SELECT 1 FROM planning_state WHERE user_id=$1 AND caught_up_through >= $4::date)`, user, old.ID, now, today)
		if err != nil {
			return t, err
		}
	}
	if !sameDate(old.ScheduledDate, t.ScheduledDate) {
		if err = Exception(ctx, tx, user, t, "moved", now); err != nil {
			return t, err
		}
	}
	return t, Event(ctx, tx, user, zone, kind, now, &old, t)
}
func Delete(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, old Task) error {
	_, err := tx.Exec(ctx, `UPDATE tasks SET deleted_at=$3,updated_at=$3,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, old.ID, now)
	if err != nil {
		return err
	}
	after := old
	after.Revision++
	after.UpdatedAt = now
	if err = Exception(ctx, tx, user, after, "deleted", now); err != nil {
		return err
	}
	return Event(ctx, tx, user, zone, "deleted", now, &old, after)
}

func sameDate(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
func EditableDate(ctx context.Context, tx pgx.Tx, user string, date *string) error {
	if date == nil {
		return nil
	}
	var finalized bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$2)`, user, *date).Scan(&finalized); err != nil {
		return err
	}
	if finalized {
		return Invalid("This daily plan is finalized; choose an editable date")
	}
	return nil
}
func Exception(ctx context.Context, tx pgx.Tx, user string, t Task, reason string, now time.Time) error {
	if t.SeriesID == nil {
		return nil
	}
	_, e := tx.Exec(ctx, `INSERT INTO recurrence_exceptions(user_id,series_id,original_occurrence_date,task_id,reason,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,series_id,original_occurrence_date) DO UPDATE SET reason=EXCLUDED.reason`, user, t.SeriesID, t.OriginalOccurrenceDate, t.ID, reason, now)
	return e
}
