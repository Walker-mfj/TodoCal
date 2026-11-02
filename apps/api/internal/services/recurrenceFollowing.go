package services

import (
	"context"
	"encoding/json"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

// Tail operations always use the immutable original slot, never its moved date.
func followingSeries(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, selected Task, revision int64) (Series, error) {
	if selected.SeriesID == nil || selected.OriginalOccurrenceDate == nil {
		return Series{}, Invalid("This task does not repeat")
	}
	sr, err := GetSeries(ctx, tx, user, *selected.SeriesID)
	if err != nil {
		return sr, err
	}
	if revision != sr.Revision {
		return sr, Conflict()
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		return sr, err
	}
	if *selected.OriginalOccurrenceDate < now.In(loc).Format("2006-01-02") || (selected.ScheduledDate != nil && *selected.ScheduledDate < now.In(loc).Format("2006-01-02")) {
		return sr, Invalid("Choose a current or future original occurrence")
	}
	var finalized bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$2::date)`, user, selected.ScheduledDate).Scan(&finalized)
	if err != nil {
		return sr, err
	}
	if finalized {
		return sr, Invalid("Choose an occurrence outside finalized history")
	}
	return sr, nil
}

func tailTasks(ctx context.Context, tx pgx.Tx, user, id, cutoff string) ([]Task, error) {
	rows, err := tx.Query(ctx, `SELECT `+repository.TaskColumns+` FROM tasks WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date >= $3::date ORDER BY original_occurrence_date`, user, id, cutoff)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Task
	for rows.Next() {
		t, e := repository.ScanTask(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func UpdateFollowing(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, selected Task, in TaskInput, revision int64, fields map[string]json.RawMessage) (Task, error) {
	sr, err := followingSeries(ctx, tx, user, zone, now, selected, revision)
	if err != nil {
		return Task{}, err
	}
	if in.ScheduledDate == nil || selected.ScheduledDate == nil {
		return Task{}, Invalid("Repeating tasks require a scheduled date")
	}
	if err = Validate(&in, zone, now, &selected); err != nil {
		return Task{}, err
	}
	if err = CheckGroup(ctx, tx, user, in.GroupID); err != nil {
		return Task{}, err
	}
	cutoff := *selected.OriginalOccurrenceDate
	affected, err := tailTasks(ctx, tx, user, sr.ID, cutoff)
	if err != nil {
		return Task{}, err
	}
	delta := localdate.Days(*selected.ScheduledDate, *in.ScheduledDate)
	loc, _ := time.LoadLocation(zone)
	today := now.In(loc).Format("2006-01-02")
	if *in.ScheduledDate < today {
		return Task{}, Invalid("This and following cannot move repetitions into the past")
	}
	// A protected selected task cannot represent an edit which leaves it unchanged.
	var selectedProtected bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM focus_sessions WHERE user_id=$1 AND task_id=$2)`, user, selected.ID).Scan(&selectedProtected)
	if err != nil {
		return Task{}, err
	}
	if selected.Status == "complete" || selectedProtected {
		return Task{}, Invalid("Completed or focused occurrences can only be edited individually")
	}
	template := applyFields(sr.Task, in, fields)
	template.ScheduledDate = in.ScheduledDate
	if err = Validate(&template, zone, now, nil); err != nil {
		return Task{}, err
	}
	rule := RecurrenceRule{Cadence: sr.Cadence, IntervalDays: sr.IntervalDays, EndDate: sr.EndDate}
	_, changesRule := fields["recurrence"]
	if changesRule {
		if err = json.Unmarshal(fields["recurrence"], &rule); err != nil {
			return Task{}, Invalid("Invalid recurrence rule")
		}
		switch rule.Cadence {
		case "daily":
			if rule.IntervalDays != 0 && rule.IntervalDays != 1 {
				return Task{}, Invalid("Daily interval must be 1")
			}
			rule.IntervalDays = 1
		case "weekly":
			if rule.IntervalDays != 0 && rule.IntervalDays != 7 {
				return Task{}, Invalid("Weekly interval must be 7")
			}
			rule.IntervalDays = 7
		case "interval":
			if rule.IntervalDays < 2 || rule.IntervalDays > 365 {
				return Task{}, Invalid("Interval must be 2–365 days")
			}
		default:
			return Task{}, Invalid("Choose daily, interval, or weekly recurrence")
		}
		if rule.EndDate != nil {
			if _, e := localdate.Parse(*rule.EndDate); e != nil || *rule.EndDate < *in.ScheduledDate {
				return Task{}, Invalid("End date must be on or after the start date")
			}
		}
	}
	newID := uuid.NewString()
	offset := sr.ScheduleOffset + delta
	anchorDate := localdate.Add(cutoff, offset)
	if anchorDate < today {
		return Task{}, Invalid("This and following cannot move repetitions into the past")
	}
	if changesRule && rule.EndDate != nil && *rule.EndDate < anchorDate {
		return Task{}, Invalid("End date must be on or after the tail start date")
	}
	template.ScheduledDate = &anchorDate
	deadlineOffset, deadlineTime := sr.Offset, sr.DeadlineTime
	if _, edits := fields["deadline"]; !edits && deadlineOffset != nil {
		n := *deadlineOffset - delta
		deadlineOffset = &n
	}
	if _, ok := fields["deadline"]; ok {
		deadlineOffset, deadlineTime = nil, nil
		if in.Deadline != nil {
			d := in.Deadline.In(loc)
			n := localdate.Days(*in.ScheduledDate, d.Format("2006-01-02"))
			clock := d.Format("15:04:05")
			deadlineOffset, deadlineTime = &n, &clock
		}
	}
	raw, _ := json.Marshal(template)
	_, err = tx.Exec(ctx, `INSERT INTO recurrence_series(user_id,id,template,group_id,start_date,cadence,interval_days,end_date,stopped_after,deadline_offset,deadline_time,created_at,schedule_offset_days,original_cutoff) SELECT user_id,$3,$4,$5,$6,cadence,interval_days,end_date,stopped_after,$7,$8,$9,$10,original_cutoff FROM recurrence_series WHERE user_id=$1 AND id=$2`, user, sr.ID, newID, raw, template.GroupID, cutoff, deadlineOffset, deadlineTime, now, offset)
	if err != nil {
		return Task{}, err
	}
	if changesRule {
		var endOriginal *string
		if rule.EndDate != nil {
			d := localdate.Add(*rule.EndDate, -offset)
			endOriginal = &d
		}
		_, err = tx.Exec(ctx, `UPDATE recurrence_series SET cadence=$3,interval_days=$4,end_date=$5 WHERE user_id=$1 AND id=$2`, user, newID, rule.Cadence, rule.IntervalDays, endOriginal)
		if err != nil {
			return Task{}, err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE recurrence_series SET original_cutoff=$3,revision=revision+1,stop_undo=NULL WHERE user_id=$1 AND id=$2`, user, sr.ID, cutoff)
	if err != nil {
		return Task{}, err
	}
	// Move ownership, not identity. This includes deleted slots and history-bearing tasks.
	_, err = tx.Exec(ctx, `UPDATE tasks SET series_id=$4,revision=revision+1 WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date >= $3::date`, user, sr.ID, cutoff, newID)
	if err != nil {
		return Task{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE recurrence_exceptions SET series_id=$4 WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date >= $3::date`, user, sr.ID, cutoff, newID)
	if err != nil {
		return Task{}, err
	}
	// Predictions are recomputed under the new template. Durable user exceptions stay.
	if _, err = repository.ClearShiftedInvalidTimeExceptions(ctx, tx, user, newID, offset, today); err != nil {
		return Task{}, err
	}
	for _, old := range affected {
		if old.DeletedAt != nil || old.Status == "complete" || old.ScheduledDate == nil || *old.ScheduledDate < today {
			continue
		}
		var protected bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM focus_sessions WHERE user_id=$1 AND task_id=$2) OR EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$3::date)`, user, old.ID, old.ScheduledDate).Scan(&protected)
		if err != nil {
			return Task{}, err
		}
		if protected {
			continue
		}
		old.SeriesID = &newID
		old.Revision++
		if changesRule && (localdate.Days(cutoff, *old.OriginalOccurrenceDate)%rule.IntervalDays != 0 || (rule.EndDate != nil && localdate.Add(*old.OriginalOccurrenceDate, offset) > *rule.EndDate)) {
			// Explicitly moved exceptions remain accepted overrides even off cadence.
			var moved bool
			err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM recurrence_exceptions WHERE user_id=$1 AND series_id=$2 AND original_occurrence_date=$3::date AND reason='moved')`, user, newID, old.OriginalOccurrenceDate).Scan(&moved)
			if err != nil {
				return Task{}, err
			}
			if moved {
				continue
			}
			if err = DeleteTask(ctx, tx, user, zone, now, old); err != nil {
				return Task{}, err
			}
			continue
		}
		next := applyFields(old.TaskInput, in, fields)
		date := localdate.Add(*old.ScheduledDate, delta)
		if date < today {
			return Task{}, Invalid("This and following cannot move repetitions into the past")
		}
		next.ScheduledDate = &date
		if _, ok := fields["deadline"]; ok && deadlineOffset != nil {
			d, e := localdate.Instant(localdate.Add(date, *deadlineOffset), *deadlineTime, loc)
			if e != nil {
				return Task{}, Invalid("This deadline does not exist in your time zone")
			}
			next.Deadline = &d
		}
		if _, err = UpdateTask(ctx, tx, user, zone, now, old, next); err != nil {
			return Task{}, err
		}
	}
	return GetTask(ctx, tx, user, selected.ID)
}

type RecurrenceRule = models.RecurrenceRule

type tailUndo struct {
	Kind           string           `json:"kind"`
	PreviousCutoff *string          `json:"previousCutoff"`
	Tasks          map[string]int64 `json:"tasks"`
}

func DeleteFollowing(ctx context.Context, tx pgx.Tx, user, zone string, now time.Time, selected Task, revision int64, confirmCompleted bool) (any, error) {
	sr, err := followingSeries(ctx, tx, user, zone, now, selected, revision)
	if err != nil {
		return nil, err
	}
	cutoff := *selected.OriginalOccurrenceDate
	tasks, err := tailTasks(ctx, tx, user, sr.ID, cutoff)
	if err != nil {
		return nil, err
	}
	undo := tailUndo{Kind: "following", Tasks: map[string]int64{}}
	err = tx.QueryRow(ctx, `SELECT original_cutoff::text FROM recurrence_series WHERE user_id=$1 AND id=$2`, user, sr.ID).Scan(&undo.PreviousCutoff)
	if err != nil {
		return nil, err
	}
	loc, _ := time.LoadLocation(zone)
	today := now.In(loc).Format("2006-01-02")
	for _, t := range tasks {
		if t.DeletedAt != nil || (t.ScheduledDate != nil && *t.ScheduledDate < today) {
			continue
		}
		var finalized bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM daily_snapshots WHERE user_id=$1 AND date=$2::date)`, user, t.ScheduledDate).Scan(&finalized)
		if err != nil {
			return nil, err
		}
		if finalized {
			continue
		}
		if t.Status == "complete" && !confirmCompleted {
			return nil, Invalid("Confirm deletion of completed future occurrences; their history will be retained")
		}
		if err = DeleteTask(ctx, tx, user, zone, now, t); err != nil {
			return nil, err
		}
		undo.Tasks[t.ID] = t.Revision + 1
	}
	raw, _ := json.Marshal(undo)
	_, err = tx.Exec(ctx, `UPDATE recurrence_series SET original_cutoff=$3,stop_undo=$4,revision=revision+1 WHERE user_id=$1 AND id=$2`, user, sr.ID, cutoff, raw)
	return map[string]any{"ok": true, "revision": selected.Revision + 1, "seriesId": sr.ID, "seriesRevision": sr.Revision + 1}, err
}
