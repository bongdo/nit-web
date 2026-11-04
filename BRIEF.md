# nit-gui

Web GUI for the same OpenCode v2 service the `nit` TUI talks to.

## Product

A fast, quiet chat client for working with coding agents. One screen: sessions on
the left, transcript in the middle, composer at the bottom. No setup wizard, no
account. It connects to the local OpenCode service and to a named URL.

The reason this exists: a terminal cannot show rich HTML, wide tables, images or
a comfortable long-form chat. The GUI can.

## Non-goals

- No terminal emulator, file manager, IDE or VCS panel.
- No database, no server-side accounts, no telemetry.
- No second chat engine. OpenCode remains the only source of truth.

## Stack

- Go 1.26 backend using only the standard library plus `github.com/bongdo/nit`
  is **not** imported: this project is standalone.
- React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui components.
- One embedded static bundle served by the Go binary.
- `bin/run` builds the web bundle when missing and starts on `127.0.0.1:7788`.
- `bin/check` runs Go tests/build and the frontend typecheck, unit tests and build.

## Backend

Discovery mirrors `nit`: `NIT_SERVER` / `OPENCODE_SERVER`, then
`opencode service status`, and the password in `~/.config/opencode/service.json`.
Use Basic auth `opencode:<password>`.

Endpoints under `/api`:

- `GET /api/health` — `{ok, server, version}`.
- `GET /api/sessions?dir=` — session list.
- `POST /api/sessions` — create `{directory, title?, agent?, model?}`.
- `GET /api/sessions/{id}/messages` — transcript.
- `POST /api/sessions/{id}/prompt` — `{text}`.
- `POST /api/sessions/{id}/interrupt`.
- `GET /api/models`, `GET /api/agents`.
- `GET /api/events` — server-sent events proxied from OpenCode.
- `GET /api/config` — directory, model and agent defaults.

The proxy must never expose the password to the browser. Limit JSON bodies to
1 MiB. Set short timeouts except for the event stream.

## Frontend

- Left rail: search, new session, session list with title, directory, relative
  age, running dot.
- Main: user/assistant messages; markdown with GFM tables and task lists; code
  blocks with copy; tool calls collapsed; streaming text.
- Composer: textarea, Enter sends, Shift+Enter newline, stop button while
  streaming, token/cost footer when available.
- Model and agent pickers in the header.
- HTML in chat: a fenced ```html block gets a "Preview" switch that renders the
  document in a sandboxed `iframe srcdoc` without `allow-same-origin`. A plain
  HTML document in an assistant message gets the same toggle. Never inject raw
  HTML into the app DOM.
- Dark and light themes, system default; compact density; keyboard: `mod+k`
  search, `mod+n` new session, `mod+enter` send, `esc` stop.
- Empty, loading, offline and error states are real screens, not blank space.
- Use shadcn/ui primitives and lucide icons; no giant UI framework.

## Acceptance

1. `bin/check` is green.
2. `bin/run` starts and `GET /api/health` answers against the live OpenCode
   service.
3. A new session can be created, a prompt sent, streamed text appears without a
   reload, and stop works.
4. An assistant message containing `<h1>Hi</h1>` offers a preview and the preview
   renders it in a sandboxed iframe.
5. Layout works at 1280px and 900px; no horizontal scroll on the transcript.
6. README explains install, run, environment and the security model.

## Rules

- No comments in code except build directives and `shortcut:` notes.
- Keep the dependency list small and explain every addition in README.
- Save after each working milestone with `save "..."` from the project root.
