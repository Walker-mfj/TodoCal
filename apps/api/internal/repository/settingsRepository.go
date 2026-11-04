package repository

import (
	"context"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5/pgconn"
)

func ReadSettings(ctx context.Context, db DBTX, userID string, out *models.Settings) error {
	return db.QueryRow(ctx, `SELECT timezone,appearance,focus_minutes,short_break_minutes,long_break_minutes,sound,timer_sound,sound_volume,revision FROM settings WHERE user_id=$1`, userID).Scan(&out.Timezone, &out.Appearance, &out.FocusMinutes, &out.ShortBreakMinutes, &out.LongBreakMinutes, &out.Sound, &out.TimerSound, &out.SoundVolume, &out.Revision)
}

func UpdateSettings(ctx context.Context, db DBTX, userID string, zone string, appearance string, focusMinutes int, shortBreakMinutes int, longBreakMinutes int, sound bool, timerSound string, soundVolume int) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE settings SET timezone=$2,appearance=$3,focus_minutes=$4,short_break_minutes=$5,long_break_minutes=$6,sound=$7,timer_sound=$8,sound_volume=$9,revision=revision+1 WHERE user_id=$1`, userID, zone, appearance, focusMinutes, shortBreakMinutes, longBreakMinutes, sound, timerSound, soundVolume)
}
