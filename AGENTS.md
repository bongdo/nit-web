# nit-gui

- `bin/check` — typecheck, unit tests, production build, `gofmt`, `go vet`, Go tests and build. It must be green before you report or deploy.
- `bin/deploy [nixos|frankfurt]`, `bin/nixos` and `bin/frankfurt` — build and
  restart the app. `bin/nixos` copies to the remote host; `bin/frankfurt` runs
  locally behind Caddy on `:7792`.
- After a green `bin/check` and a successful deploy, `save "<what changed>"`.
- `bin/run` is the local development server on `127.0.0.1:7788`.

## Drop

- `drop <path>` publishes a file, static page or folder and prints a URL. Use it
  when the user should see a page, a full app, or download a file. Do not paste
  large HTML into chat instead.
- Default is private and permanent. `--public` allows anonymous reads;
  `--expire 2w` deletes after two weeks; `--slug name` sets the URL.
- `drop list`, `drop url <id|slug>`, `drop rm <id|slug>`,
  `drop slug <id|slug> <new>`, `drop access <id|slug> public|private`.
- The manager `/nit/drop/` is behind the `nit_gate` cookie. Public content is
  `/nit/d/<slug>/`; private links return 404 when anonymous.
- A folder with `index.html` is served directly as a page, with no iframe. A
  folder without one gets a bare file index. Markdown is not rendered by drop;
  the manager links to pero with `?open=<absolute path>`.
- Public HTML runs sandboxed with an opaque origin, no fetch/XHR/WebSocket and
  no form submission.
