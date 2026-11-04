package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"nitgui/internal/opencode"
	"nitgui/internal/server"
)

//go:embed all:web/dist
var embedded embed.FS

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	dist, err := fs.Sub(embedded, "web/dist")
	if err != nil {
		log.Error("frontend bundle missing", "error", err)
		os.Exit(1)
	}
	provider := opencode.NewManager()
	handler := server.New(provider, dist, log)

	srv := &http.Server{
		Addr:              "127.0.0.1:7788",
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		if c, err := provider.Client(context.Background()); err == nil {
			log.Info("opencode service discovered", "server", c.BaseURL)
		} else {
			log.Warn("opencode service not found; the UI will show offline", "error", err)
		}
		log.Info("nit-gui listening", "url", "http://127.0.0.1:7788")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server stopped", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("shutdown", "error", err)
	}
}
