# nit-gui

- `bin/check` — typecheck, unit tests, production build, `gofmt`, `go vet`, Go tests and build. The only build and test command; it must be green before you report or deploy.
- `bin/deploy` — the only publish command: builds the web bundle with base `/nit/`, builds the Go binary, restarts it on `127.0.0.1:7791` and reloads Caddy on `10.0.0.88:443`, which proxies to the gate on `127.0.0.1:8090`. Public at `https://bongdo.space/nit/`; the old ts.net entry is gone. Only the main worktree may deploy: it takes a global lock and refuses to run from a linked worktree, so parallel agents do not restart the live server under each other.
- Cycle: green `bin/check` → `save "<what changed>"` → `bin/deploy` → report `https://bongdo.space/nit/` and what to look at.
- A UI or behavior change is not done until it is deployed: the user sees the old build.
- `bin/auth` prints the password once and stores only its hash. If you rotate it,
  print the new password in the reply.
- `bin/run` is the local development server on `127.0.0.1:7788`.
- `bin/previews` screenshots `/nit`, `/pero`, `/term` and `/share` into
  `~/.local/state/nit-gui/gate/previews` for the root page thumbnails. It needs a
  local chromium; the Playwright cache is found automatically. Run it after
  `bin/gate` when an app's look changes. Without it the cards show a placeholder.
- `bin/page <file> [--title "Title"]` validates an HTML page in headless Chromium
  and prints the `[[html:...]]` line to paste into the reply. It accepts fragments,
  copies unsafe or outside paths into `.nit/pages/`, and prints only that line.
- `bin/gate` builds and restarts the auth gate on `127.0.0.1:8090`; Caddy
  proxies the domain there, the gate routes `/nit`, `/pero`, `/term`, `/share`.
- `bin/mount-home <ssh-host>` mounts that machine's home at the same absolute
  path here, through a systemd user unit `sshfs-<host>.service`. It needs `sshfs`
  and fuse3, and the mount point has to exist once (`sudo mkdir -p <home>`).
- If `bin/` gains or loses a command, update this list in the same change.

## HTML answers

- Do not paste a page into the reply. Write a `.html` file, run
  `bin/page <file> [--title "Title"]`, and paste the single line it prints. That
  line is the marker nit-gui renders inline as part of the answer.
- The tool handles validation, paths, titles and copying. Do not hand-write the
  marker and do not check the path yourself.
- Leave `html`/`body` background transparent and use `currentColor` or
  semi-transparent surfaces, so the page follows the app's light and dark theme.
  Do not hardcode a white page background.
- A marker inside a code fence stays text. If the page logs an error or renders
  empty, `page` exits non-zero with the reason: fix the page and run it again.

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
