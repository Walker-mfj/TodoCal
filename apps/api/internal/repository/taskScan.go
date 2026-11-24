package repository

import (
	"errors"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
)

func ScanTask(row pgx.Row) (models.Task, error) {
	var t models.Task
	err := row.Scan(&t.ID, &t.Title, &t.Description, &t.GroupID, &t.Priority, &t.ScheduledDate, &t.StartTime, &t.EndTime, &t.Deadline, &t.EstimatedPomodoros, &t.Status, &t.Revision, &t.CreatedAt, &t.UpdatedAt, &t.SeriesID, &t.OriginalOccurrenceDate, &t.FocusMinutes, &t.CompletedAt, &t.DeletedAt, &t.ActualFocusSeconds, &t.FocusProgress, &t.RecurrenceCadence, &t.RecurrenceIntervalDays, &t.ScheduledEndDate, &t.ScheduledStartAt, &t.ScheduledEndAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, &models.Fault{Code: "not_found", Message: "Resource not found"}
	}
	t.CreatedAt = t.CreatedAt.UTC()
	t.UpdatedAt = t.UpdatedAt.UTC()
	if t.CompletedAt != nil {
		v := t.CompletedAt.UTC()
		t.CompletedAt = &v
	}
	if t.DeletedAt != nil {
		v := t.DeletedAt.UTC()
		t.DeletedAt = &v
	}
	if t.Deadline != nil {
		v := t.Deadline.UTC()
		t.Deadline = &v
	}
	for _, stamp := range []*time.Time{t.ScheduledStartAt, t.ScheduledEndAt} {
		if stamp != nil {
			*stamp = stamp.UTC()
		}
	}
	return t, err
}
