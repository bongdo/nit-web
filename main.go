package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"io/fs"
	"log/slog"
	"net"
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
	addr := flag.String("addr", "127.0.0.1:7788", "listen address")
	flag.Parse()
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	dist, err := fs.Sub(embedded, "web/dist")
	if err != nil {
		log.Error("frontend bundle missing", "error", err)
		os.Exit(1)
	}
	provider := opencode.NewRegistry()
	defer provider.Close()
	handler := server.New(provider, dist, log)
	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	srv := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
	}

	go func() {
		if c, err := provider.Client(context.Background()); err == nil {
			log.Info("opencode service discovered", "server", c.BaseURL)
		} else {
			log.Warn("opencode service not found; the UI will show offline", "error", err)
		}
		log.Info("nit-gui listening", "url", "http://"+*addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("server stopped", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	cancelBase()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Warn("streams did not close, forcing shutdown", "error", err)
		_ = srv.Close()
	}
}
