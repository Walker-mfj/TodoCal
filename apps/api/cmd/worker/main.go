package main

import (
	"context"
	"flag"
	"focuscalendar/internal/config"
	"focuscalendar/internal/planning"
	"github.com/jackc/pgx/v5/pgxpool"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata"
)

func main() {
	once := flag.Bool("once", false, "Run one catch-up sweep and exit")
	flag.Parse()
	cfg, e := config.Load(os.Getenv)
	if e != nil {
		slog.Error("invalid worker configuration")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, e := pgxpool.New(ctx, cfg.DatabaseURL)
	if e != nil {
		slog.Error("invalid database configuration")
		os.Exit(1)
	}
	defer pool.Close()
	sweeper := &planning.Sweeper{}
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		sweep, cancel := context.WithTimeout(ctx, 50*time.Second)
		count, err := sweeper.Sweep(sweep, pool, time.Now)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("catch-up sweep failed", "accountsProcessed", count)
		} else if err == nil {
			slog.Info("catch-up sweep complete", "accountsProcessed", count)
		}
		if *once {
			if err != nil {
				os.Exit(1)
			}
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
