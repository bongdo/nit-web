package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"nitgui/internal/drop"
)

func main() {
	store, err := drop.Open(drop.DefaultRoot())
	if err != nil {
		fail(err)
	}
	services := drop.NewServices(store)
	args := os.Args[1:]
	if len(args) == 0 {
		usage()
		return
	}
	switch args[0] {
	case "help", "-h", "--help":
		usage()
	case "list", "ls":
		list(store, services, args[1:])
	case "rm", "delete":
		remove(store, args[1:])
	case "url":
		showURL(store, args[1:])
	case "slug":
		setSlug(store, args[1:])
	case "access":
		setAccess(store, args[1:])
	case "service":
		publishService(store, services, args[1:])
	case "start":
		serviceAction(store, services, "start", args[1:])
	case "stop":
		serviceAction(store, services, "stop", args[1:])
	case "restart":
		serviceAction(store, services, "restart", args[1:])
	case "update":
		serviceAction(store, services, "update", args[1:])
	case "logs":
		serviceLogs(store, services, args[1:])
	case "web", "docs", "doc":
		publish(store, args[1:])
	default:
		publish(store, args)
	}
}

func usage() {
	fmt.Print(`drop — publish a file, page or folder

  drop <path> [--public] [--slug name] [--expire 2w]
  drop service <dir> [--public] [--slug name] [--expire 2w]
  drop list
  drop url <id|slug>
  drop rm <id|slug>
  drop slug <id|slug> <new-slug>
  drop access <id|slug> public|private
  drop start|stop|restart <id|slug>
  drop update <id|slug>
  drop logs <id|slug> [-f]

A service needs Containerfile/Dockerfile, or drop.json with "image".
drop.json may also set {"port":3000,"health":"/","cmd":["..."],
"env":{"KEY":"value"},"env_file":".env","volume":"/data"}.
Default: private, forever. --expire 2w deletes after two weeks.
update rebuilds the image while the old container still runs, then
restarts it; use it to deploy. restart is a hard restart.
`)
}

func list(store *drop.Store, services *drop.Services, args []string) {
	if len(args) != 0 {
		fail(fmt.Errorf("usage: drop list"))
	}
	entries, err := store.List()
	if err != nil {
		fail(err)
	}
	if len(entries) == 0 {
		fmt.Println("empty")
		return
	}
	for _, entry := range entries {
		status := ""
		if entry.Kind == "service" {
			status = services.Status(context.Background(), entry)
		}
		fmt.Printf("%s  %-24s  %-9s  %-7s  %-8s  %-10s  %s\n",
			entry.ID,
			short(entry.Slug, 24),
			entry.Kind,
			access(entry),
			expires(entry),
			status,
			entryURL(entry),
		)
	}
}

func remove(store *drop.Store, args []string) {
	if len(args) != 1 {
		fail(fmt.Errorf("usage: drop rm <id|slug>"))
	}
	if err := store.Delete(args[0]); err != nil {
		fail(err)
	}
	fmt.Println("removed", args[0])
}

func showURL(store *drop.Store, args []string) {
	if len(args) != 1 {
		fail(fmt.Errorf("usage: drop url <id|slug>"))
	}
	entry, err := store.Get(args[0])
	if err != nil {
		fail(err)
	}
	fmt.Println(entryURL(entry))
}

func setSlug(store *drop.Store, args []string) {
	if len(args) != 2 {
		fail(fmt.Errorf("usage: drop slug <id|slug> <new-slug>"))
	}
	entry, err := store.SetSlug(args[0], args[1])
	if err != nil {
		fail(err)
	}
	fmt.Println(entryURL(entry))
	fmt.Printf("%s  %s\n", entry.ID, entry.Slug)
}

func setAccess(store *drop.Store, args []string) {
	if len(args) != 2 {
		fail(fmt.Errorf("usage: drop access <id|slug> public|private"))
	}
	var public bool
	switch strings.ToLower(args[1]) {
	case "public":
		public = true
	case "private":
		public = false
	default:
		fail(fmt.Errorf("access must be public or private"))
	}
	entry, err := store.SetPublic(args[0], public)
	if err != nil {
		fail(err)
	}
	fmt.Println(entryURL(entry))
	fmt.Printf("%s  %s\n", entry.ID, access(entry))
}

func publishService(store *drop.Store, services *drop.Services, args []string) {
	parsed, err := parse(args)
	if err != nil {
		fail(err)
	}
	cfg, err := drop.LoadServiceConfig(parsed.path)
	if err != nil {
		fail(err)
	}
	fmt.Fprintf(os.Stderr, "drop: building %s\n", cfg.Dir)
	entry, err := services.Create(context.Background(), cfg.Dir, drop.PublishOptions{
		Slug:   parsed.slug,
		Public: parsed.public,
		TTL:    parsed.ttl,
	}, cfg)
	if err != nil {
		fail(err)
	}
	fmt.Println(entryURL(entry))
	fmt.Printf("%s  %s  service  %s  %s  %s\n", entry.ID, entry.Slug, access(entry), expires(entry), serviceStatus(entry))
}

func serviceAction(store *drop.Store, services *drop.Services, action string, args []string) {
	if len(args) != 1 {
		fail(fmt.Errorf("usage: drop %s <id|slug>", action))
	}
	entry, err := store.Get(args[0])
	if err != nil {
		fail(err)
	}
	if entry.Kind != "service" || entry.Service == nil {
		fail(errors.New("not a service"))
	}
	ctx := context.Background()
	switch action {
	case "start":
		entry, err = services.Start(ctx, entry)
	case "stop":
		entry, err = services.Stop(ctx, entry)
	case "restart":
		entry, err = services.Restart(ctx, entry)
	case "update":
		entry, err = services.Update(ctx, entry)
	}
	if err != nil {
		fail(err)
	}
	fmt.Println(entryURL(entry))
	fmt.Printf("%s  %s  %s\n", entry.ID, entry.Slug, serviceStatus(entry))
}

func serviceLogs(store *drop.Store, services *drop.Services, args []string) {
	follow := false
	ref := ""
	for _, arg := range args {
		switch arg {
		case "-f", "--follow":
			follow = true
		default:
			if strings.HasPrefix(arg, "-") {
				fail(fmt.Errorf("unknown flag %s", arg))
			}
			if ref != "" {
				fail(errors.New("usage: drop logs <id|slug> [-f]"))
			}
			ref = arg
		}
	}
	if ref == "" {
		fail(errors.New("usage: drop logs <id|slug> [-f]"))
	}
	entry, err := store.Get(ref)
	if err != nil {
		fail(err)
	}
	if entry.Kind != "service" || entry.Service == nil {
		fail(errors.New("not a service"))
	}
	if err := services.Logs(context.Background(), entry, follow, os.Stdout, os.Stderr); err != nil {
		fail(err)
	}
}

func serviceStatus(entry drop.Entry) string {
	if entry.Service == nil {
		return ""
	}
	if entry.Service.Status == "" {
		return "unknown"
	}
	return entry.Service.Status
}

func publish(store *drop.Store, args []string) {
	parsed, err := parse(args)
	if err != nil {
		fail(err)
	}
	entry, err := store.PublishPath(parsed.path, parsed.name, drop.PublishOptions{
		Slug:   parsed.slug,
		Public: parsed.public,
		TTL:    parsed.ttl,
	})
	if err != nil {
		fail(err)
	}
	fmt.Println(entryURL(entry))
	fmt.Printf("%s  %s  %s  %s\n", entry.ID, entry.Slug, access(entry), expires(entry))
}

type publishArgs struct {
	path   string
	name   string
	slug   string
	public bool
	ttl    time.Duration
}

func parse(args []string) (publishArgs, error) {
	var parsed publishArgs
	var paths []string
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "--public", "-public":
			parsed.public = true
		case "--ttl", "-ttl", "--expire", "-expire":
			index++
			if index >= len(args) {
				return publishArgs{}, fmt.Errorf("%s needs a value", args[index-1])
			}
			ttl, err := drop.ParseTTL(args[index])
			if err != nil {
				return publishArgs{}, err
			}
			parsed.ttl = ttl
		case "--name", "-name":
			index++
			if index >= len(args) {
				return publishArgs{}, fmt.Errorf("--name needs a value")
			}
			parsed.name = args[index]
		case "--slug", "-slug":
			index++
			if index >= len(args) {
				return publishArgs{}, fmt.Errorf("--slug needs a value")
			}
			parsed.slug = args[index]
		case "--help", "-h":
			usage()
			os.Exit(0)
		default:
			if strings.HasPrefix(args[index], "-") {
				return publishArgs{}, fmt.Errorf("unknown flag %s", args[index])
			}
			paths = append(paths, args[index])
		}
	}
	if len(paths) != 1 {
		return publishArgs{}, fmt.Errorf("usage: drop <path> [--public] [--slug name] [--expire 2w]")
	}
	parsed.path = paths[0]
	return parsed, nil
}

func entryURL(entry drop.Entry) string {
	return publicBase() + url.PathEscape(entry.Slug) + "/"
}

func publicBase() string {
	if value := strings.TrimSpace(os.Getenv("DROP_PUBLIC_BASE")); value != "" {
		return strings.TrimRight(value, "/") + "/"
	}
	return "http://127.0.0.1:7788/nit/d/"
}

func access(entry drop.Entry) string {
	if entry.Public {
		return "public"
	}
	return "private"
}

func expires(entry drop.Entry) string {
	if entry.Expires == nil {
		return "never"
	}
	return entry.Expires.Format("2006-01-02")
}

func short(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max-1] + "…"
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "drop:", err)
	os.Exit(1)
}
