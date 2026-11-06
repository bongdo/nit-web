# nit-gui

- `bin/check` — typecheck, unit tests, production build, `gofmt`, `go vet`, Go tests and build. It must be green before you report or deploy.
- `bin/deploy [nixos|frankfurt]`, `bin/nixos` and `bin/frankfurt` — build and
  restart the app. `bin/nixos` copies to the remote host; `bin/frankfurt` runs
  locally behind Caddy on `:7792`.
- After a green `bin/check` and a successful deploy, `save "<what changed>"`.
- `bin/run` is the local development server on `127.0.0.1:7788`.
