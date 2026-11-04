# nit-gui

Web GUI for the local OpenCode v2 service. Sessions on the left, transcript in
the middle, composer at the bottom. It is a client only: OpenCode remains the
source of truth for sessions, messages, models and agents.

## Run

```sh
./bin/run
```

Open <http://127.0.0.1:7788>. `bin/run` installs frontend dependencies if
needed, builds the web bundle when sources are newer, builds the Go binary and
serves it on loopback.

```sh
./bin/check
```

`bin/check` runs the frontend typecheck, unit tests and production build, then
`gofmt`, `go vet`, Go tests and a Go build. The Go binary embeds `web/dist`, so
the frontend build always runs before the Go build.

Development with hot reload:

```sh
./bin/run             # backend on 127.0.0.1:7788
npm --prefix web run dev
```

Vite proxies `/api` to the backend.

## Discovery and environment

The backend finds the same service the `nit` TUI uses:

1. `NIT_SERVER`, then `OPENCODE_SERVER`, then `OPENCODE_URL`.
2. Otherwise `opencode service status`.
3. The password comes from `${XDG_CONFIG_HOME:-$HOME/.config}/opencode/service.json`.

Requests use Basic auth `opencode:<password>`. `0.0.0.0` / `::` status URLs are
rewritten to loopback. Credentials in a server URL are discarded.

| Variable | Meaning |
| --- | --- |
| `NIT_SERVER` | Explicit OpenCode server URL. |
| `OPENCODE_SERVER` | Same, OpenCode-native name. |
| `OPENCODE_URL` | Same, supported for parity with `nit`. |
| `XDG_CONFIG_HOME` | Used to locate `opencode/service.json`. |
| `NIT_PORT` | Not supported; the listener is fixed at `127.0.0.1:7788`. |

If the service is down, the GUI still starts and shows an offline screen with a
retry button. Health is polled every 20 seconds.

## API

The browser only talks to these same-origin endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | `{ok, server, version}` from OpenCode `/api/info`. |
| `GET /api/config` | Directory, default model and primary agent. |
| `GET /api/sessions?dir=` | Newest sessions. |
| `POST /api/sessions` | Create `{directory, title?, agent?, model?}`. |
| `GET /api/sessions/{id}/messages` | Full transcript, ascending, paginated upstream. |
| `POST /api/sessions/{id}/prompt` | Send `{text}`. |
| `POST /api/sessions/{id}/interrupt` | Stop the active execution. |
| `POST /api/sessions/{id}/model` | Switch model `{model}`. |
| `POST /api/sessions/{id}/agent` | Switch agent `{agent}`. |
| `GET /api/models`, `GET /api/agents` | Pickers. |
| `GET /api/events` | Server-sent events proxied from OpenCode `/api/event`. |

OpenCode's plural resource paths are singular (`/api/session`, `/api/model`,
`/api/agent`, `/api/event`); the mapping is deliberate and lives in the backend.

## Security model

- The listener is hard-coded to `127.0.0.1:7788`; there is no remote mode.
- The service password stays in the Go process. It is never written to HTML,
  JSON, SSE events or logs. The browser sees only same-origin `/api` responses.
- `Host` is restricted to `localhost`, `127.0.0.1` and `::1`. Cross-origin
  `POST` requests are rejected by checking `Origin` when present.
- JSON request bodies are capped at 1 MiB. Upstream JSON responses are capped at
  64 MiB. API requests have a 20 second upstream timeout; the event stream is
  exempt and is cancelled when the browser disconnects.
- Markdown is rendered by `react-markdown` without raw-HTML rehype. Model output
  never becomes part of the app DOM. An HTML-looking message or a fenced
  `html` block gets a preview button; the preview runs in
  `iframe srcdoc` with `sandbox="allow-scripts allow-forms allow-modals"`.
  `allow-same-origin` is absent, so preview scripts run in an opaque origin and
  cannot read the app, cookies or local storage. Preview code can still make
  network requests, so treat it as untrusted content.
- The app has no accounts, database, telemetry or analytics.

## Frontend behaviour

- Sidebar: search, new session, title, directory, relative age, running dot.
- Streaming text, reasoning, tool calls collapsed by default, code copy,
  GFM tables/task lists.
- Composer: Enter sends, Shift+Enter adds a line, stop while streaming, token
  and cost footer when OpenCode reports them.
- Model and agent pickers in the header; changes are applied to the current
  session and remembered for the next new session.
- Dark, light and system themes. Theme is stored in `localStorage`.
- Shortcuts: `mod+k` search, `mod+n` new session, `mod+enter` send (in the
  composer), `esc` stop.
- Layout: persistent sidebar at 1280px and 900px, collapsible drawer on narrow
  screens; code blocks and tables scroll inside themselves, not the transcript.

## Dependencies

Backend: Go standard library only. No OpenCode or `nit` package is imported.

Frontend runtime:

| Package | Why |
| --- | --- |
| `react`, `react-dom` | UI runtime. |
| `react-markdown` | Safe markdown rendering with a component API. |
| `remark-gfm` | GFM tables, task lists, strikethrough, autolinks. |
| `lucide-react` | Icons used by the shadcn-style primitives and chat. |
| `clsx`, `tailwind-merge` | `cn()` class composition used by the primitives. |
| `class-variance-authority` | Variants for the local shadcn/ui button and badge. |

Frontend development and build:

| Package | Why |
| --- | --- |
| `vite`, `@vitejs/plugin-react` | Dev server and production bundle. |
| `typescript`, `@types/react`, `@types/react-dom` | Typecheck and React types. |
| `tailwindcss`, `@tailwindcss/vite` | Tailwind 4 and theme tokens. |
| `vitest` | Pure unit tests for HTML detection, streaming reduction, formatting. |

There is no Radix, no component framework and no syntax highlighter. The
shadcn/ui primitives are local source files (`Button`, `Input`, `Textarea`,
`Badge`, `Select`), so they follow shadcn's shape without adding dependencies.

## Known limits

- Sessions are listed up to OpenCode's newest 100. Search filters that window
  client-side.
- A transcript is assembled from at most 20 upstream pages (100 messages each).
  Longer sessions are truncated at 2000 messages.
- No file attachments, permission prompt UI, session deletion, forking, shell
  panel, PTY or VCS panel. The brief puts those out of scope.
- No syntax highlighting in code blocks; copy and HTML preview are implemented.
- The HTML preview is a fixed-height iframe, not a full-window renderer.
- One browser origin only; there is no authentication in front of the GUI
  because it is loopback-only.

## Decisions

See [`docs/decisions.md`](docs/decisions.md).
