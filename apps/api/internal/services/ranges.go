package services

import (
	"time"

	"focuscalendar/internal/localdate"
	"focuscalendar/internal/models"
)

type Range = models.Range

func Ranges(period, date string, loc *time.Location, now time.Time) (Range, error) {
	d, e := localdate.Parse(date)
	if e != nil {
		return Range{}, Invalid("Choose a valid report date")
	}
	var start, end, prev time.Time
	switch period {
	case "week":
		start = d.AddDate(0, 0, -(int(d.Weekday())+6)%7)
		end = start.AddDate(0, 0, 7)
		prev = start.AddDate(0, 0, -7)
	case "month":
		start = time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, time.UTC)
		end = start.AddDate(0, 1, 0)
		prev = start.AddDate(0, -1, 0)
	default:
		return Range{}, Invalid("Choose week or month")
	}
	r := Range{From: start.Format("2006-01-02"), To: end.Format("2006-01-02"), PreviousFrom: prev.Format("2006-01-02"), PreviousTo: start.Format("2006-01-02")}
	if start.Year() < 1 || end.Year() > 9999 || prev.Year() < 1 {
		return r, Invalid("Report range is outside supported dates")
	}
	a, b := localdate.Boundary(r.From, loc), localdate.Boundary(r.To, loc)
	r.Cutoff = b
	r.PreviousCutoff = a
	if now.Before(a) {
		r.Cutoff = a
		r.PreviousCutoff = localdate.Boundary(r.PreviousFrom, loc)
		return r, nil
	}
	if now.Before(b) {
		r.Cutoff = now
		local := now.In(loc)
		date := localdate.Add(r.PreviousFrom, localdate.Days(r.From, local.Format("2006-01-02")))
		if date >= r.PreviousTo {
			return r, nil
		}
		clock := local.Format("15:04:05")
		cut, err := localdate.Instant(date, clock, loc)
		if err != nil {
			naive, _ := time.Parse("2006-01-02 15:04:05", date+" "+clock)
			for i := 0; i < 1440; i++ {
				naive = naive.Add(time.Minute)
				cut, err = localdate.Instant(naive.Format("2006-01-02"), naive.Format("15:04:05"), loc)
				if err == nil {
					break
				}
			}
		}
		if err != nil {
			return r, err
		}
		cut = cut.Add(time.Duration(local.Nanosecond()))
		if cut.Before(a) {
			r.PreviousCutoff = cut
		}
	}
	return r, nil
}
