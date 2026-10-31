package database

import (
	"context"
	"embed"
	"errors"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

func Migrate(ctx context.Context, p *pgxpool.Pool) error {
	if err := p.Ping(ctx); err != nil {
		return err
	}
	source, err := iofs.New(migrationFiles, "migrations")
	if err != nil {
		return err
	}
	m, err := migrate.NewWithSourceInstance("iofs", source, p.Config().ConnString())
	if err != nil {
		return err
	}
	defer func() { _, _ = m.Close() }()
	err = m.Up()
	if errors.Is(err, migrate.ErrNoChange) {
		return nil
	}
	return err
}
