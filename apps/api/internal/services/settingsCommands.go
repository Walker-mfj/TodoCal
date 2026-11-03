package services

import (
	"context"
	"time"

	"focuscalendar/internal/models"
	"focuscalendar/internal/repository"

	"github.com/jackc/pgx/v5"
)

type SettingsInput = models.SettingsInput
type Settings = models.Settings

func readSettings(ctx context.Context, tx pgx.Tx, user string) (Settings, error) {
	var out Settings
	e := repository.ReadSettings(ctx, tx, user, &out)
	return out, e
}

func GetSettingsCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, error) {
	return readSettings(ctx, tx, p.ID)
}
func EditSettingsCommand(ctx context.Context, tx pgx.Tx, p Principal, zone string, now time.Time, input CommandInput, params Parameters) (any, models.Outcome, error) {
	current, e := readSettings(ctx, tx, p.ID)
	if e != nil {
		return nil, 0, e
	}
	rev, e := input.Revision()
	if e != nil {
		return nil, 0, e
	}
	if rev != current.Revision {
		return nil, 0, Conflict()
	}
	in, e := input.SettingsPatch(current.SettingsInput)
	if e != nil {
		return nil, 0, e
	}
	if in.Timezone == "" || in.Timezone == "Local" {
		return nil, 0, Invalid("Choose an explicit IANA time zone")
	}
	if _, e = time.LoadLocation(in.Timezone); e != nil {
		return nil, 0, Invalid("Choose a valid time zone")
	}
	if in.Appearance != "light" && in.Appearance != "dark" {
		return nil, 0, Invalid("Choose light or dark appearance")
	}
	for _, duration := range []struct {
		kind    string
		minutes int
	}{
		{"focus", in.FocusMinutes}, {"short_break", in.ShortBreakMinutes}, {"long_break", in.LongBreakMinutes},
	} {
		if err := validateDuration(duration.kind, int64(duration.minutes)); err != nil {
			return nil, 0, err
		}
	}
	switch in.TimerSound {
	case "classic", "bell", "soft_bell", "double_bell", "singing_bowl", "doorbell", "chime", "digital":
	default:
		return nil, 0, Invalid("Choose a valid timer sound")
	}
	if in.Timezone != current.Timezone {
		if e = BeforeZoneChange(ctx, tx, p.ID, current.Timezone, in.Timezone, now); e != nil {
			return nil, 0, e
		}
	}
	_, e = repository.UpdateSettings(ctx, tx, p.ID, in.Timezone, in.Appearance, in.FocusMinutes, in.ShortBreakMinutes, in.LongBreakMinutes, in.Sound, in.TimerSound)
	return Settings{SettingsInput: in, Revision: current.Revision + 1}, models.Updated, e
}
