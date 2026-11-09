# nit-gui

- `bin/check` — typecheck, unit tests, production build, `gofmt`, `go vet`, Go tests and build. It must be green before you report or deploy.
- `bin/deploy [nixos|frankfurt]`, `bin/nixos` and `bin/frankfurt` — build and
  restart the app. `bin/nixos` copies to the remote host; `bin/frankfurt` runs
  locally behind Caddy on `:7792`.
- After a green `bin/check` and a successful deploy, `save "<what changed>"`.
- `bin/run` is the local development server on `127.0.0.1:7788`.

## Drop

- `drop <path>` publishes a file or directory to `/nit/drop/` and prints a URL.
  Use it when the user should see a rendered HTML page, a full app, or download
  a file. Do not paste large HTML into chat instead.
- `drop web <dir>` requires `index.html`; `drop docs <dir>` publishes docs and
  returns the reader URL. Relative `.md` links work inside the reader.
- `drop list`, `drop url <id>`, `drop rm <id>`.
- Default TTL is 7 days; pass `--ttl 1h`, `24h`, `7d` or `0`.
- Published pages are behind the same `nit_gate` login, not public.
- HTML apps run sandboxed without network or form access.
