package services

import (
	"context"
	"math"
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
)

type FocusEntry = models.FocusEntry
type AnalyticsDay = models.AnalyticsDay
type Metrics = models.Metrics
type Comparison = models.Comparison
type Report = models.Report

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
func analyticsMaxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
func day(ctx context.Context, tx pgx.Tx, user, zone, date string, now, cutoff time.Time, asOf bool) (AnalyticsDay, error) {
	out := AnalyticsDay{FocusTimezone: zone, CompletedIDs: []string{}, FocusSessions: []FocusEntry{}}
	plan, e := DayReport(ctx, tx, user, zone, date, now)
	if e != nil {
		return out, e
	}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return out, e
	}
	start, end := localdate.Boundary(date, loc), localdate.Boundary(localdate.Add(date, 1), loc)
	if asOf && !cutoff.Before(start) && cutoff.Before(end) {
		plan, e = DayAt(ctx, tx, user, plan.Timezone, date, cutoff)
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
	out.CompletedIDs, e = repository.ListCompletedTaskIDs(ctx, tx, user, date, minTime(now, cutoff), zone)
	if e != nil {
		return out, e
	}
	out.CompletedTasks = len(out.CompletedIDs)
	intervals, e := repository.ListFocusIntervals(ctx, tx, user, start, end)
	if e != nil {
		return out, e
	}
	// Ordinary reports credit completed sessions back to their start day even
	// when completion falls beyond the period boundary. Historical comparisons
	// must only count completions known at their as-of cutoff.
	completionCutoff := now
	if asOf {
		completionCutoff = minTime(now, cutoff)
	}
	entries := map[string]*FocusEntry{}
	order := []string{}
	for _, interval := range intervals {
		id, title, status := interval.ID, interval.Title, interval.Status
		target, accum := interval.Target, interval.Accumulated
		ended, pom := interval.Ended, interval.Pomodoros
		intervalStart, intervalEnd := interval.Start, interval.End
		finish := end
		if intervalEnd != nil {
			finish = minTime(finish, *intervalEnd)
		} else {
			finish = minTime(finish, time.UnixMicro(intervalStart.UnixMicro()+target*1000000-accum))
		}
		begin := analyticsMaxTime(start, intervalStart)
		seconds := float64(max(int64(0), finish.UnixMicro()-begin.UnixMicro())) / 1e6
		count := 0
		if pom == 1 && ended != nil && !interval.SessionStarted.Before(start) && interval.SessionStarted.Before(localdate.Boundary(localdate.Add(date, 1), loc)) && !ended.After(completionCutoff) {
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
	for _, id := range order {
		entry := *entries[id]
		out.FocusSessions = append(out.FocusSessions, entry)
		out.FocusSeconds += entry.FocusSeconds
		out.Pomodoros += entry.Pomodoros
	}
	return out, nil
}
func AnalyticsDayReport(ctx context.Context, tx pgx.Tx, user, zone, date string, now time.Time) (AnalyticsDay, error) {
	if _, e := Active(ctx, tx, user, now); e != nil {
		return AnalyticsDay{}, e
	}
	if e := Materialize(ctx, tx, user, zone, date, localdate.Add(date, 1), now); e != nil {
		return AnalyticsDay{}, e
	}
	return day(ctx, tx, user, zone, date, now, now, false)
}
func aggregate(ctx context.Context, tx pgx.Tx, user, zone, from, to string, now, cutoff time.Time, comparison bool) (Metrics, []AnalyticsDay, error) {
	metrics := Metrics{}
	days := []AnalyticsDay{}
	ids := map[string]bool{}
	loc, e := time.LoadLocation(zone)
	if e != nil {
		return metrics, days, e
	}
	if e = Materialize(ctx, tx, user, zone, from, to, now); e != nil {
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
	if _, e = Active(ctx, tx, user, now); e != nil {
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
