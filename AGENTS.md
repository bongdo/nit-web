# nit-gui

- `bin/check` — typecheck, unit tests, production build, `gofmt`, `go vet`, Go tests and build. It must be green before you report or deploy.
- `bin/deploy` — build for the remote host and restart it on `127.0.0.1:7791`. Run it after every finished change, then open <http://127.0.0.1:7791/>.
- After a green `bin/check` and a successful deploy, `save "<what changed>"`.
- `bin/run` is the local development server on `127.0.0.1:7788`.
