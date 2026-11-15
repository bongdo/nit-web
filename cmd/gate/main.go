package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"nitgui/internal/drop"
	"nitgui/internal/gate"
	"nitgui/internal/gateid"
)

func main() {
	addr := flag.String("addr", envOr("NIT_GATE_ADDR", "127.0.0.1:8090"), "listen address")
	admin := flag.String("admin", envOr("NIT_GATE_ADMIN", "bongdo"), "name of the seeded admin")
	flag.Parse()

	if args := flag.Args(); len(args) > 0 && args[0] == "token" {
		if err := tokenCommand(args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, "gate:", err)
			os.Exit(1)
		}
		return
	}

	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	secret, err := gateid.LoadSecret(gateid.DefaultSecretPath())
	if err != nil {
		log.Error("gate key", "error", err)
		os.Exit(1)
	}
	agents, err := gate.OpenAgents(gate.DefaultAgentsPath())
	if err != nil {
		log.Error("gate agents", "error", err)
		os.Exit(1)
	}
	users, err := gate.OpenStore(gate.DefaultUsersPath())
	if err != nil {
		log.Error("gate users", "error", err)
		os.Exit(1)
	}
	if users.Count() == 0 {
		hash := strings.TrimSpace(os.Getenv("NIT_GATE_PASSWORD_HASH"))
		if hash == "" {
			hash = strings.TrimSpace(os.Getenv("NIT_GUI_PASSWORD_HASH"))
		}
		if hash == "" {
			log.Error("no admin: set NIT_GATE_PASSWORD_HASH or run bin/auth")
			os.Exit(1)
		}
		if err := users.Seed(*admin, gateid.RoleAdmin, hash); err != nil {
			log.Error("seed admin", "error", err)
			os.Exit(1)
		}
		log.Info("seeded admin", "name", *admin)
	}
	routes, err := gate.OpenRoutes(gate.DefaultRoutesPath())
	if err != nil {
		log.Error("gate routes", "error", err)
		os.Exit(1)
	}

	server := gate.New(routes, users, agents, secret, log)
	server.SetAudit(gate.OpenAudit(gate.DefaultAuditPath()))
	if store, err := drop.OpenReadOnly(envOr("NIT_GATE_DROP", drop.DefaultRoot())); err != nil {
		log.Warn("gate drop links unavailable", "error", err)
	} else {
		server.SetDrops(store)
	}
	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	reload := make(chan os.Signal, 1)
	signal.Notify(reload, syscall.SIGHUP)
	go func() {
		for range reload {
			if err := routes.Reload(); err != nil {
				log.Warn("routes reload failed", "error", err)
				continue
			}
			log.Info("routes reloaded", "routes", len(routes.List()))
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-stop
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	}()

	log.Info("gate listening", "url", "http://"+*addr+"/", "users", users.Count(), "routes", len(routes.List()))
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("gate stopped", "error", err)
		os.Exit(1)
	}
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func tokenCommand(args []string) error {
	agents, err := gate.OpenAgents(gate.DefaultAgentsPath())
	if err != nil {
		return err
	}
	if len(args) == 0 {
		return errors.New("usage: gate token add|rm|list [name]")
	}
	switch args[0] {
	case "add":
		if len(args) < 2 {
			return errors.New("usage: gate token add <name>")
		}
		token, err := agents.Add(args[1])
		if err != nil {
			return err
		}
		fmt.Println(token)
	case "rm":
		if len(args) < 2 {
			return errors.New("usage: gate token rm <name>")
		}
		if err := agents.Remove(args[1]); err != nil {
			return err
		}
		fmt.Println("removed", args[1])
	case "list":
		for _, machine := range agents.List() {
			fmt.Printf("%s\t%s\n", machine.Name, time.Unix(machine.Added, 0).Format(time.RFC3339))
		}
	default:
		return errors.New("usage: gate token add|rm|list [name]")
	}
	return nil
}
