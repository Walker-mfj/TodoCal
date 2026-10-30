package repository

import (
	"context"
	"time"

	"focuscalendar/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func ReadGroup(ctx context.Context, db DBTX, userID string, groupID string, out *models.Group) error {
	return db.QueryRow(ctx, `SELECT id::text,name,color,revision FROM groups WHERE user_id=$1 AND id=$2`, userID, groupID).Scan(&out.ID, &out.Name, &out.Color, &out.Revision)
}

func ListGroups(ctx context.Context, db DBTX, userID string) ([]models.Group, error) {
	rows, err := db.Query(ctx, `SELECT id::text,name,color,revision FROM groups WHERE user_id=$1 ORDER BY lower(name),id`, userID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Group, error) { return scanGroup(row) })
}

func InsertGroup(ctx context.Context, db DBTX, userID string, groupID string, name string, color string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `INSERT INTO groups(user_id,id,name,color) VALUES($1,$2,$3,$4)`, userID, groupID, name, color)
}

func UpdateGroup(ctx context.Context, db DBTX, userID string, groupID string, name string, color string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE groups SET name=$3,color=$4,revision=revision+1 WHERE user_id=$1 AND id=$2`, userID, groupID, name, color)
}

func ListGroupTasks(ctx context.Context, db DBTX, userID string, groupID string) ([]models.Task, error) {
	rows, err := db.Query(ctx, `SELECT `+TaskColumns+` FROM tasks WHERE user_id=$1 AND group_id=$2 AND deleted_at IS NULL`, userID, groupID)
	if err != nil {
		return nil, err
	}
	return collect(rows, func(row pgx.Row) (models.Task, error) { return ScanTask(row) })
}

func UnlinkGroupTasks(ctx context.Context, db DBTX, userID string, groupID string, now time.Time) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE tasks SET group_id=NULL,revision=revision+1,updated_at=$3 WHERE user_id=$1 AND group_id=$2`, userID, groupID, now)
}

func UnlinkGroupSeries(ctx context.Context, db DBTX, userID string, groupID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `UPDATE recurrence_series SET group_id=NULL WHERE user_id=$1 AND group_id=$2`, userID, groupID)
}

func DeleteGroup(ctx context.Context, db DBTX, userID string, groupID string) (pgconn.CommandTag, error) {
	return db.Exec(ctx, `DELETE FROM groups WHERE user_id=$1 AND id=$2`, userID, groupID)
}
