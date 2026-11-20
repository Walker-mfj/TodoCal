package main

import (
	"context"
	"errors"
	"flag"
	"focuscalendar/internal/database"
	"focuscalendar/internal/diagnostics"
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
	enabled := os.Getenv("OBSERVABILITY_ENABLED") == "true"
	if enabled {
		out, closeExports := diagnostics.ConfigureExports(os.Getenv, os.Stdout)
		defer closeExports()
		slog.SetDefault(diagnostics.Logger(out, os.Getenv("RENDER_GIT_COMMIT"), os.Getenv("APP_ENV")))
	}
	poolCfg, err := poolConfig(cfg.DatabaseURL, enabled)
	if err != nil {
		return errors.New("invalid database configuration")
	}
	pool, err := pgxpool.NewWithConfig(startup, poolCfg)
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
	notifications := services.NotificationWorker{Pool: pool, Now: time.Now, Sender: sender, EnforceLateness: true}
	scheduler := workers.NewScheduler(&workers.NotificationSchedule{Pool: pool, Now: time.Now, Notifications: notifications})
	app.ConfigureScheduleWake(scheduler.Wake)
	lockPath := os.Getenv("SCHEDULER_LOCK_PATH")
	var leaderFile *os.File
	if lockPath != "" {
		leaderFile, err = workers.OpenHostLeaderLock(lockPath)
		if err != nil {
			return errors.New("scheduler host lock unavailable")
		}
		defer func() { _ = leaderFile.Close() }()
		app.ConfigureScheduleBroadcast()
	}
	schedulerCtx, cancelScheduler := context.WithCancel(ctx)
	schedulerDone := make(chan struct{})
	go func() {
		defer close(schedulerDone)
		if leaderFile == nil {
			scheduler.Run(schedulerCtx)
			return
		}
		if e := workers.RunHostLeader(schedulerCtx, leaderFile, func(leaderCtx context.Context) {
			listenCtx, cancelListen := context.WithCancel(leaderCtx)
			listenerDone := make(chan struct{})
			go func() {
				defer close(listenerDone)
				workers.ListenScheduleWake(listenCtx, pool.Config().ConnConfig, scheduler.Wake)
			}()
			defer func() { cancelListen(); <-listenerDone }()
			scheduler.Run(leaderCtx)
		}); e != nil {
			slog.Error("scheduler host lock failed")
			stop()
		}
	}()
	defer func() { cancelScheduler(); <-schedulerDone }()
	closeMonitoring := app.EnableMonitoring(os.Getenv("BETTER_STACK_DSN"), os.Getenv("RENDER_GIT_COMMIT"))
	defer closeMonitoring()
	handler := middleware.ProxyHandler(app.Handler(), os.Getenv("PROXY_SECRET"))
	if enabled {
		handler = diagnostics.HTTP(handler, slog.Default())
		poolCtx, cancelPool := context.WithCancel(ctx)
		poolDone := make(chan struct{})
		go func() { defer close(poolDone); diagnostics.LogPool(poolCtx, pool, slog.Default(), time.Minute) }()
		defer func() { cancelPool(); <-poolDone }()
	}
	api := &http.Server{Addr: cfg.Address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
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

func poolConfig(url string, enabled bool) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	if enabled {
		cfg.ConnConfig.Tracer = diagnostics.PGTracer{}
	}
	return cfg, nil
}
