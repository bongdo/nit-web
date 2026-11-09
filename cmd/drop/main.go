package main

import (
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
	args := os.Args[1:]
	if len(args) == 0 {
		usage()
		return
	}
	switch args[0] {
	case "help", "-h", "--help":
		usage()
	case "list", "ls":
		list(store, args[1:])
	case "rm", "delete":
		remove(store, args[1:])
	case "url":
		showURL(store, args[1:])
	case "slug":
		setSlug(store, args[1:])
	case "access":
		setAccess(store, args[1:])
	case "web", "docs", "doc":
		publish(store, args[1:])
	default:
		publish(store, args)
	}
}

func usage() {
	fmt.Print(`drop — publish a file, page or folder

  drop <path> [--public] [--slug name] [--expire 2w]
  drop list
  drop url <id|slug>
  drop rm <id|slug>
  drop slug <id|slug> <new-slug>
  drop access <id|slug> public|private

Default: private, forever. --expire 2w deletes after two weeks.
`)
}

func list(store *drop.Store, args []string) {
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
		fmt.Printf("%s  %-24s  %-7s  %-8s  %s\n",
			entry.ID,
			short(entry.Slug, 24),
			access(entry),
			expires(entry),
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
