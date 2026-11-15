# nit-gui

- `bin/check` — typecheck, unit tests, production build, `gofmt`, `go vet`, Go tests and build. It must be green before you report or deploy.
- `bin/deploy [nixos|frankfurt]`, `bin/nixos` and `bin/frankfurt` — build and
  restart the app. `bin/nixos` copies to the remote host; `bin/frankfurt` runs
  locally behind Caddy on `:7792`.
- Cycle: green `bin/check` → `save "<what changed>"` → `bin/deploy` (nixos by
  default, `frankfurt` for the public URL) → report the URL and what to look at.
- A UI or behavior change is not done until it is deployed: the user sees the old build.
- `bin/auth` prints the password once and stores only its hash. If you rotate it,
  print the new password in the reply.
- `bin/run` is the local development server on `127.0.0.1:7788`.
- If `bin/` gains or loses a command, update this list in the same change.

## Drop

- `drop <path>` publishes a file, static page or folder and prints a URL. Use it
  for a full page, app or download, not for a one-off visual.
- A small visual goes inline in the answer as a fenced `html` block. Do not paste a
  whole app or a multi-file page into chat: publish it with `drop`.
- Default is private and permanent. `--public` allows anonymous reads;
  `--expire 2w` deletes after two weeks; `--slug name` sets the URL.
- `drop list`, `drop url <id|slug>`, `drop rm <id|slug>`,
  `drop slug <id|slug> <new>`, `drop access <id|slug> public|private`.
- The manager `/share/` is behind the `nit_gate` cookie. Public content is
  `/share/<slug>/`; private links return 404 when anonymous.
- A folder with `index.html` is served directly as a page, with no iframe. A
  folder without one gets a bare file index. Markdown is not rendered by drop;
  the manager links to pero with `?open=<absolute path>`.
- Public HTML runs sandboxed with an opaque origin, no fetch/XHR/WebSocket and
  no form submission.
