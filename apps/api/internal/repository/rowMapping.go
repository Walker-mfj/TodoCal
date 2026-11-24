package repository

import (
	"encoding/json"
	"errors"
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
)

// collect closes the cursor before services issue another query on the same transaction.
func collect[T any](rows pgx.Rows, scan func(pgx.Row) (T, error)) ([]T, error) {
	defer rows.Close()
	values := []T{}
	for rows.Next() {
		value, err := scan(rows)
		if err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}
func scanString(row pgx.Row) (v string, err error) { err = row.Scan(&v); return }
func scanGroup(row pgx.Row) (g models.Group, err error) {
	err = row.Scan(&g.ID, &g.Name, &g.Color, &g.Revision)
	return
}
func scanWarning(row pgx.Row) (map[string]string, error) {
	var id, date, reason string
	err := row.Scan(&id, &date, &reason)
	return map[string]string{"seriesId": id, "date": date, "reason": reason}, err
}
func scanHistoricalTask(row pgx.Row) (v models.Task, err error) {
	var raw []byte
	if err = row.Scan(&raw); err == nil {
		err = json.Unmarshal(raw, &v)
	}
	return
}
func scanSnapshotEntry(row pgx.Row) (v models.Entry, err error) {
	var raw []byte
	if err = row.Scan(&raw); err == nil {
		err = json.Unmarshal(raw, &v)
	}
	return
}
func scanMaterializableSeries(row pgx.Row) (sr models.Series, err error) {
	var raw []byte
	var start string
	var group *string
	err = row.Scan(&sr.ID, &raw, &group, &start, &sr.Cadence, &sr.IntervalDays, &sr.EndDate, &sr.StoppedAfter, &sr.Offset, &sr.DeadlineTime, &sr.CreatedAt, &sr.ScheduleOffset, &sr.Timezone)
	if err != nil {
		return
	}
	if err = json.Unmarshal(raw, &sr.Task); err != nil {
		return
	}
	if sr.Task.ScheduledDate != nil && sr.Task.ScheduledEndDate != nil {
		sr.EndOffset = localdate.Days(*sr.Task.ScheduledDate, *sr.Task.ScheduledEndDate)
	}
	sr.Task.GroupID = group
	sr.Task.ScheduledDate = &start
	return
}

// FocusInterval is one persisted interval and its parent session's final state.
// Services determine its overlap with the requested reporting period.
type FocusInterval struct {
	ID                  string
	Title               *string
	Status              string
	Target, Accumulated int64
	Ended               *time.Time
	Pomodoros           int
	SessionStarted      time.Time
	Start               time.Time
	End                 *time.Time
}

func scanFocusInterval(row pgx.Row) (v FocusInterval, err error) {
	err = row.Scan(&v.ID, &v.Title, &v.Status, &v.Target, &v.Accumulated, &v.Ended, &v.Pomodoros, &v.SessionStarted, &v.Start, &v.End)
	return
}
func ScanFocus(row pgx.Row) (*models.FocusSession, error) {
	s := new(models.FocusSession)
	err := row.Scan(&s.ID, &s.TaskID, &s.TaskTitle, &s.Kind, &s.Status, &s.TargetSeconds, &s.Accumulated, &s.RunningSince, &s.StartedAt, &s.EndedAt, &s.Pomodoros, &s.Revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}
