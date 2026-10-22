package analytics

import (
	"context"
	"focuscalendar/internal/focus"
	"focuscalendar/internal/localdate"
	"focuscalendar/internal/planning"
	"focuscalendar/internal/recurrence"
	"github.com/jackc/pgx/v5"
	"math"
	"time"
)

type FocusEntry struct {
	ID           string  `json:"id"`
	TaskTitle    *string `json:"taskTitle"`
	Status       string  `json:"status"`
	FocusSeconds float64 `json:"focusSeconds"`
	Pomodoros    int     `json:"pomodoros"`
}
type Day struct {
	planning.Day
	FocusTimezone  string       `json:"focusTimezone"`
	CompletedTasks int          `json:"completedTasks"`
	CompletedIDs   []string     `json:"completedIds"`
	FocusSeconds   float64      `json:"focusSeconds"`
	Pomodoros      int          `json:"pomodoros"`
	FocusSessions  []FocusEntry `json:"focusSessions"`
}
type Metrics struct {
	Planned        int      `json:"planned"`
	Completed      int      `json:"completed"`
	Percentage     *float64 `json:"percentage"`
	CompletedTasks int      `json:"completedTasks"`
	FocusSeconds   float64  `json:"focusSeconds"`
	Pomodoros      int      `json:"pomodoros"`
	CompleteDays   int      `json:"completeDays"`
	PlannedDays    int      `json:"plannedDays"`
}
type Comparison struct {
	From                  string    `json:"from"`
	To                    string    `json:"to"`
	Through               time.Time `json:"through"`
	Metrics               Metrics   `json:"metrics"`
	PercentagePointChange *float64  `json:"percentagePointChange"`
	FocusSecondsChange    *float64  `json:"focusSecondsChange"`
}
type Report struct {
	Period     string     `json:"period"`
	From       string     `json:"from"`
	To         string     `json:"to"`
	Through    time.Time  `json:"through"`
	Timezone   string     `json:"timezone"`
	Metrics    Metrics    `json:"metrics"`
	Days       []Day      `json:"days"`
	Comparison Comparison `json:"comparison"`
}

func percent(done, total int) *float64 {
	if total == 0 {
		return nil
	}
	p := math.Round(float64(done)*1000/float64(total)) / 10
	if done < total && p >= 100 {
		p = 99.9
	}
	return &p
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
func day(ctx context.Context, tx pgx.Tx, user, zone, date string, now, cutoff time.Time, asOf bool) (Day, error) {
	out := Day{FocusTimezone: zone, CompletedIDs: []string{}, FocusSessions: []FocusEntry{}}
	plan, e := planning.DayReport(ctx, tx, user, zone, date, now)
	if e != nil {
		return out, e
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return out, e
	}
	start, end := localdate.Boundary(date, loc), localdate.Boundary(localdate.Add(date, 1), loc)
	if asOf && !cutoff.Before(start) && cutoff.Before(end) {
		plan, e = planning.DayAt(ctx, tx, user, plan.Timezone, date, cutoff)
		if e != nil {
			return out, e
		}
	}
	out.Day = plan
	end = minTime(end, minTime(now, cutoff))
	if end.Before(start) {
		out.Percentage = nil
		return out, nil
	}
	rows, e := tx.Query(ctx, `SELECT DISTINCT task_id::text FROM task_events WHERE user_id=$1 AND kind='completed' AND local_date=$2::date AND occurred_at<=$3 AND (invalidated_at IS NULL OR invalidated_at>$3) ORDER BY task_id::text`, user, date, minTime(now, cutoff))
	if e != nil {
		return out, e
	}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return out, e
		}
		out.CompletedIDs = append(out.CompletedIDs, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	out.CompletedTasks = len(out.CompletedIDs)
	rows, e = tx.Query(ctx, `SELECT s.id::text,s.task_title,s.status,s.target_seconds,s.accumulated_us,s.ended_at,s.pomodoros,i.started_at,i.ended_at FROM focus_sessions s JOIN focus_intervals i ON i.user_id=s.user_id AND i.session_id=s.id WHERE s.user_id=$1 AND s.kind='focus' AND i.started_at<=$3 AND (COALESCE(i.ended_at,$3)>=$2 OR s.ended_at>=$2) ORDER BY s.sequence,i.ordinal`, user, start, end)
	if e != nil {
		return out, e
	}
	entries := map[string]*FocusEntry{}
	order := []string{}
	for rows.Next() {
		var id, status string
		var title *string
		var target, accum int64
		var ended, intervalEnd *time.Time
		var pom int
		var intervalStart time.Time
		if e = rows.Scan(&id, &title, &status, &target, &accum, &ended, &pom, &intervalStart, &intervalEnd); e != nil {
			rows.Close()
			return out, e
		}
		finish := end
		if intervalEnd != nil {
			finish = minTime(finish, *intervalEnd)
		} else {
			finish = minTime(finish, time.UnixMicro(intervalStart.UnixMicro()+target*1000000-accum))
		}
		begin := maxTime(start, intervalStart)
		seconds := float64(max(int64(0), finish.UnixMicro()-begin.UnixMicro())) / 1e6
		count := 0
		if pom == 1 && ended != nil && !ended.Before(start) && ended.Before(localdate.Boundary(localdate.Add(date, 1), loc)) && !ended.After(end) {
			count = 1
		}
		if seconds == 0 && count == 0 {
			continue
		}
		entry := entries[id]
		if entry == nil {
			entry = &FocusEntry{ID: id, TaskTitle: title, Status: status}
			entries[id] = entry
			order = append(order, id)
		}
		entry.FocusSeconds += seconds
		entry.Pomodoros = max(entry.Pomodoros, count)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return out, e
	}
	for _, id := range order {
		entry := *entries[id]
		out.FocusSessions = append(out.FocusSessions, entry)
		out.FocusSeconds += entry.FocusSeconds
		out.Pomodoros += entry.Pomodoros
	}
	return out, nil
}
func DayReport(ctx context.Context, tx pgx.Tx, user, zone, date string, now time.Time) (Day, error) {
	if _, e := focus.Active(ctx, tx, user, now); e != nil {
		return Day{}, e
	}
	if e := recurrence.Materialize(ctx, tx, user, zone, date, localdate.Add(date, 1), now); e != nil {
		return Day{}, e
	}
	return day(ctx, tx, user, zone, date, now, now, false)
}
func aggregate(ctx context.Context, tx pgx.Tx, user, zone, from, to string, now, cutoff time.Time, comparison bool) (Metrics, []Day, error) {
	metrics := Metrics{}
	days := []Day{}
	ids := map[string]bool{}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return metrics, days, e
	}
	if e = recurrence.Materialize(ctx, tx, user, zone, from, to, now); e != nil {
		return metrics, days, e
	}
	for date := from; date < to; date = localdate.Add(date, 1) {
		d, err := day(ctx, tx, user, zone, date, now, cutoff, comparison)
		if err != nil {
			return metrics, days, err
		}
		days = append(days, d)
		if boundary := localdate.Boundary(date, loc); boundary.After(cutoff) || boundary.After(now) {
			continue
		}
		metrics.Planned += d.Planned
		metrics.Completed += d.Completed
		metrics.FocusSeconds += d.FocusSeconds
		metrics.Pomodoros += d.Pomodoros
		if d.Planned > 0 {
			metrics.PlannedDays++
			if d.Completed == d.Planned {
				metrics.CompleteDays++
			}
		}
		for _, id := range d.CompletedIDs {
			ids[id] = true
		}
	}
	metrics.CompletedTasks = len(ids)
	metrics.Percentage = percent(metrics.Completed, metrics.Planned)
	return metrics, days, nil
}
func Period(ctx context.Context, tx pgx.Tx, user, zone, period, date string, now time.Time) (Report, error) {
	out := Report{Period: period, Timezone: zone}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return out, e
	}
	r, e := Ranges(period, date, loc, now)
	if e != nil {
		return out, e
	}
	if _, e = focus.Active(ctx, tx, user, now); e != nil {
		return out, e
	}
	out.From, out.To, out.Through = r.From, r.To, r.Cutoff.UTC()
	out.Metrics, out.Days, e = aggregate(ctx, tx, user, zone, r.From, r.To, now, r.Cutoff, false)
	if e != nil {
		return out, e
	}
	out.Comparison = Comparison{From: r.PreviousFrom, To: r.PreviousTo, Through: r.PreviousCutoff.UTC()}
	if localdate.Boundary(r.From, loc).After(now) {
		return out, nil
	}
	out.Comparison.Metrics, _, e = aggregate(ctx, tx, user, zone, r.PreviousFrom, r.PreviousTo, now, r.PreviousCutoff, true)
	if e != nil {
		return out, e
	}
	a, b := out.Metrics, out.Comparison.Metrics
	if a.Percentage != nil && b.Percentage != nil {
		v := float64(a.Completed)*100/float64(a.Planned) - float64(b.Completed)*100/float64(b.Planned)
		out.Comparison.PercentagePointChange = &v
	}
	if b.FocusSeconds > 0 {
		v := a.FocusSeconds - b.FocusSeconds
		out.Comparison.FocusSecondsChange = &v
	}
	return out, nil
}
