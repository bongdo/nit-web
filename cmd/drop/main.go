package main

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
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
	case "web":
		publishWeb(store, args[1:])
	case "docs", "doc":
		publishDocs(store, args[1:])
	default:
		publish(store, args)
	}
}

func usage() {
	fmt.Print(`drop — publish a file, site or docs to nit-gui

  drop <path> [--ttl 7d] [--name name]
  drop web <dir> [--ttl 7d]
  drop docs <dir> [--ttl 7d]
  drop list
  drop url <id>
  drop rm <id>

TTL accepts 1h, 24h, 7d, 2w or 0 for no expiry. Default: 7d.
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
		fmt.Printf("%s  %-5s  %-28s  %s  %s\n",
			entry.ID,
			entry.Kind,
			short(entry.Name, 28),
			expires(entry),
			entryURL(entry),
		)
	}
}

func remove(store *drop.Store, args []string) {
	if len(args) != 1 {
		fail(fmt.Errorf("usage: drop rm <id>"))
	}
	if err := store.Delete(args[0]); err != nil {
		fail(err)
	}
	fmt.Println("removed", args[0])
}

func showURL(store *drop.Store, args []string) {
	if len(args) != 1 {
		fail(fmt.Errorf("usage: drop url <id>"))
	}
	entry, err := store.Get(args[0])
	if err != nil {
		fail(err)
	}
	fmt.Println(entryURL(entry))
}

func publishWeb(store *drop.Store, args []string) {
	pathArgs, ttl, name, err := parse(args)
	if err != nil {
		fail(err)
	}
	if len(pathArgs) != 1 {
		fail(fmt.Errorf("usage: drop web <dir> [--ttl 7d]"))
	}
	info, err := os.Stat(pathArgs[0])
	if err != nil {
		fail(err)
	}
	if info.IsDir() {
		if _, err := os.Stat(filepath.Join(pathArgs[0], "index.html")); err != nil {
			fail(fmt.Errorf("%s has no index.html", pathArgs[0]))
		}
	} else if !isHTML(pathArgs[0]) {
		fail(fmt.Errorf("%s is not an html file", pathArgs[0]))
	}
	publishPath(store, pathArgs[0], name, ttl, false)
}

func publishDocs(store *drop.Store, args []string) {
	pathArgs, ttl, name, err := parse(args)
	if err != nil {
		fail(err)
	}
	if len(pathArgs) != 1 {
		fail(fmt.Errorf("usage: drop docs <dir> [--ttl 7d]"))
	}
	publishPath(store, pathArgs[0], name, ttl, true)
}

func publish(store *drop.Store, args []string) {
	pathArgs, ttl, name, err := parse(args)
	if err != nil {
		fail(err)
	}
	if len(pathArgs) != 1 {
		fail(fmt.Errorf("usage: drop <path> [--ttl 7d] [--name name]"))
	}
	publishPath(store, pathArgs[0], name, ttl, false)
}

func publishPath(store *drop.Store, src, name string, ttl time.Duration, docs bool) {
	entry, err := store.PublishPath(src, name, ttl)
	if err != nil {
		fail(err)
	}
	link := entryURL(entry)
	if docs {
		if doc := entry.Doc(); doc != "" {
			link += "?file=" + url.QueryEscape(doc)
		}
	}
	fmt.Println(link)
	fmt.Printf("%s  %s  %s\n", entry.ID, entry.Kind, expires(entry))
}

func parse(args []string) (paths []string, ttl time.Duration, name string, err error) {
	ttl = drop.DefaultTTL
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "--ttl", "-ttl":
			index++
			if index >= len(args) {
				return nil, 0, "", fmt.Errorf("--ttl needs a value")
			}
			ttl, err = drop.ParseTTL(args[index])
			if err != nil {
				return nil, 0, "", err
			}
		case "--name", "-name":
			index++
			if index >= len(args) {
				return nil, 0, "", fmt.Errorf("--name needs a value")
			}
			name = args[index]
		case "--help", "-h":
			usage()
			os.Exit(0)
		default:
			if strings.HasPrefix(args[index], "-") {
				return nil, 0, "", fmt.Errorf("unknown flag %s", args[index])
			}
			paths = append(paths, args[index])
		}
	}
	return paths, ttl, name, nil
}

func entryURL(entry drop.Entry) string {
	return publicBase() + "e/" + entry.ID + "/"
}

func publicBase() string {
	if value := strings.TrimSpace(os.Getenv("DROP_PUBLIC_BASE")); value != "" {
		return strings.TrimRight(value, "/") + "/"
	}
	return "http://127.0.0.1:7788/drop/"
}

func expires(entry drop.Entry) string {
	if entry.Expires.IsZero() {
		return "never"
	}
	left := time.Until(entry.Expires)
	if left <= 0 {
		return "expired"
	}
	if left >= 48*time.Hour {
		return fmt.Sprintf("%dd", int(left/(24*time.Hour)))
	}
	if left >= time.Hour {
		return fmt.Sprintf("%dh", int(left/time.Hour))
	}
	return fmt.Sprintf("%dm", int(left/time.Minute))
}

func short(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max-1] + "…"
}

func isHTML(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".html", ".htm":
		return true
	}
	return false
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "drop:", err)
	os.Exit(1)
}
