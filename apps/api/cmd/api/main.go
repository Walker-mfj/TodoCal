package main

import (
	"context"
	"errors"
	"flag"
	"focuscalendar/internal/database"
	"focuscalendar/internal/middleware"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"

	"focuscalendar/internal/config"
	"focuscalendar/internal/controllers"
	"focuscalendar/internal/services"
	"focuscalendar/internal/workers"
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
		if err = database.Migrate(startup, pool); err != nil {
			return errors.New("database migration failed")
		}
		slog.Info("migrations applied")
		return nil
	}
	app := controllers.New(pool, cfg.Origin, cfg.Secure)
	sender, err := services.NewWebPushSender(os.Getenv("VAPID_PUBLIC_KEY"), os.Getenv("VAPID_PRIVATE_KEY"), os.Getenv("VAPID_SUBJECT"))
	if err != nil {
		return errors.New("invalid Web Push configuration")
	}
	sweeper := &workers.Sweeper{}
	notifications := services.NotificationWorker{Pool: pool, Now: time.Now, Sender: sender}
	app.ConfigureJobs(os.Getenv("JOBS_SECRET"), func(jobCtx context.Context) (any, error) {
		sweepCtx, cancelSweep := context.WithTimeout(jobCtx, 10*time.Second)
		accounts, sweepErr := sweeper.Sweep(sweepCtx, pool, time.Now)
		cancelSweep()
		sent, pushErr := notifications.Run(jobCtx, 100)
		var due int
		backlogErr := pool.QueryRow(jobCtx, `SELECT count(*) FROM focus_sessions WHERE status='running' AND running_since + (target_seconds::double precision - accumulated_us::double precision / 1000000) * interval '1 second' <= CURRENT_TIMESTAMP`).Scan(&due)
		slog.Info("scheduled jobs", "accountsProcessed", accounts, "notificationsSent", sent, "expiredFocusRemaining", due)
		return map[string]int{"accountsProcessed": accounts, "notificationsSent": sent, "expiredFocusRemaining": due}, errors.Join(sweepErr, pushErr, backlogErr)
	})
	closeMonitoring := app.EnableMonitoring(os.Getenv("BETTER_STACK_DSN"), os.Getenv("RENDER_GIT_COMMIT"))
	defer closeMonitoring()
	api := &http.Server{Addr: cfg.Address, Handler: middleware.ProxyHandler(app.Handler(), os.Getenv("PROXY_SECRET")), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
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
