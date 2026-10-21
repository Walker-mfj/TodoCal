package server

import (
	"focuscalendar/internal/planning"
	"focuscalendar/internal/tasks"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

type settingsInput struct {
	Timezone          string `json:"timezone"`
	Appearance        string `json:"appearance"`
	FocusMinutes      int    `json:"focusMinutes"`
	ShortBreakMinutes int    `json:"shortBreakMinutes"`
	LongBreakMinutes  int    `json:"longBreakMinutes"`
	Sound             bool   `json:"sound"`
}
type settings struct {
	settingsInput
	Revision int64 `json:"revision"`
}

func readSettings(tx pgx.Tx, r *http.Request, user string) (settings, error) {
	var out settings
	e := tx.QueryRow(r.Context(), `SELECT timezone,appearance,focus_minutes,short_break_minutes,long_break_minutes,sound,revision FROM settings WHERE user_id=$1`, user).Scan(&out.Timezone, &out.Appearance, &out.FocusMinutes, &out.ShortBreakMinutes, &out.LongBreakMinutes, &out.Sound, &out.Revision)
	return out, e
}
func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	s.view(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time) (any, error) {
		return readSettings(tx, r, p.ID)
	})
}
func (s *Server) editSettings(w http.ResponseWriter, r *http.Request) {
	s.mutate(w, r, func(tx pgx.Tx, p Principal, zone string, now time.Time, raw []byte) (any, int, error) {
		current, e := readSettings(tx, r, p.ID)
		if e != nil {
			return nil, 0, e
		}
		rev, e := expected(raw)
		if e != nil {
			return nil, 0, e
		}
		if rev != current.Revision {
			return nil, 0, tasks.Conflict()
		}
		var in settingsInput
		if e = mergePatch(raw, current.settingsInput, &in); e != nil {
			return nil, 0, e
		}
		if in.Timezone == "" || in.Timezone == "Local" {
			return nil, 0, tasks.Invalid("Choose an explicit IANA time zone")
		}
		if _, e = time.LoadLocation(in.Timezone); e != nil {
			return nil, 0, tasks.Invalid("Choose a valid time zone")
		}
		if in.Appearance != "light" && in.Appearance != "dark" {
			return nil, 0, tasks.Invalid("Choose light or dark appearance")
		}
		for _, n := range []int{in.FocusMinutes, in.ShortBreakMinutes, in.LongBreakMinutes} {
			if n < 1 || n > 2147483647 {
				return nil, 0, tasks.Invalid("Durations must be positive whole minutes")
			}
		}
		if in.Timezone != current.Timezone {
			if e = planning.BeforeZoneChange(r.Context(), tx, p.ID, current.Timezone, in.Timezone, now); e != nil {
				return nil, 0, e
			}
		}
		_, e = tx.Exec(r.Context(), `UPDATE settings SET timezone=$2,appearance=$3,focus_minutes=$4,short_break_minutes=$5,long_break_minutes=$6,sound=$7,revision=revision+1 WHERE user_id=$1`, p.ID, in.Timezone, in.Appearance, in.FocusMinutes, in.ShortBreakMinutes, in.LongBreakMinutes, in.Sound)
		return settings{settingsInput: in, Revision: current.Revision + 1}, 200, e
	})
}
