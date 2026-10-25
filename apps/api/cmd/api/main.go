package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"focuscalendar/internal/config"
	"focuscalendar/internal/server"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	if err := run(); err != nil {
		slog.Error("API stopped", "error", err)
		os.Exit(1)
	}
}
func run() error {
	migrateOnly := flag.Bool("migrate", false, "Apply database migrations and exit")
	flag.Parse()
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(startup, cfg.DatabaseURL)
	if err != nil {
		return errors.New("invalid database configuration")
	}
	defer pool.Close()
	if err = pool.Ping(startup); err != nil {
		return errors.New("database connection failed")
	}
	if *migrateOnly {
		if err = server.Migrate(startup, pool); err != nil {
			return errors.New("database migration failed")
		}
		slog.Info("migrations applied")
		return nil
	}
	api := &http.Server{Addr: cfg.Address, Handler: server.ProxyHandler(server.New(pool, cfg.Origin, cfg.Secure).Handler(), os.Getenv("PROXY_SECRET")), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	done := make(chan error, 1)
	go func() { done <- api.ListenAndServe() }()
	slog.Info("API listening", "address", cfg.Address)
	select {
	case err = <-done:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}
	shutdown, close := context.WithTimeout(context.Background(), 10*time.Second)
	defer close()
	return api.Shutdown(shutdown)
}
