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

## Deploy

```sh
bin/nixos       # copy to nixos and restart 127.0.0.1:7791 there
bin/frankfurt   # build here and expose through Caddy on :7792
```

`bin/nixos` is `bin/deploy nixos`. It cross-compiles for the remote architecture,
copies the binary to `~/Projects/nit-gui` and restarts it. If the remote directory
has a `./run` wrapper, the restart uses it (the NixOS wrapper sets `NIT_SERVER`);
otherwise it runs `./nit-gui` directly.

`bin/frankfurt` builds locally, restarts the app on `127.0.0.1:7791`, and starts
a user Caddy on `:7792` with basic auth. It reuses the first `basicauth` entry
from `/etc/caddy/Caddyfile`; set `NIT_GUI_PUBLIC_PASSWORD` to use another
password. The public port must be open in the OCI security list. The tailnet URL
works without opening it. The listener is plain HTTP: basic auth protects access,
not the password in transit, so prefer the tailnet URL for anything private.
Dictation needs a secure context, so `http://<public-or-tailnet-ip>` cannot use
the microphone. Use an SSH tunnel to `127.0.0.1:7792` or put HTTPS in front
(Tailscale Serve/Funnel) when dictation matters.

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

## Workspaces

Every chat belongs to one directory for its whole lifetime; it cannot be moved
later. On first start the GUI asks for a workspace and remembers it in
`localStorage`. The picker lists OpenCode projects, recent workspaces and an
absolute path field.

The sidebar has three scopes:

| Scope | Shows |
| --- | --- |
| `This dir` | chats created in the current workspace. |
| `Mine` | all top-level chats with a primary agent, across workspaces. |
| `All` | everything, including subagent sessions and scripted roles. |

`New chat` does not create a session. The session is created in the current
workspace on the first Send, so an empty draft never appears in the list.

## Composer and message actions

- The textarea grows to 200 px and then scrolls inside itself.
- `/` opens the command palette: `/new`, `/dir`, `/compact`, `/revert`, `/fork`,
  `/retry`, `/theme`, `/clear`, `/help`. Commands run in the client; they are
  never sent to the model.
- Attach files with the paperclip, clipboard paste or drag and drop. The file is
  written to the OpenCode host through `/api/experimental/fs/write` and attached
  as `files: [{uri, name}]` on the next prompt. Images get a local thumbnail.
- The microphone records 16 kHz mono WAV in the browser and sends it to
  `/api/stt`; the transcript is appended to the existing input. It never sends
  and never clears what you typed. Transcription happens when you stop, not as
  a live stream.
- Spelling is checked locally for Russian and English. Misspelled words get a
  wavy underline; the `A` button lists suggestions and lets you ignore a word.
  Nothing leaves the browser. Code blocks, inline code, URLs, paths, file names
  and known project terms are skipped. Settings → Spelling turns it off.
- Hover a user message for Copy, Revert and Fork. Revert commits the revert and
  puts the message text back into the composer; Fork opens a new session before
  that message. The composer also has a fast `Undo` button for the last prompt.
- The chat header shows `N subagents` with active and finished children; click
  one to open its transcript and `Back to parent` to return.

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
| `NIT_GUI_ALLOWED_HOSTS` | Comma-separated extra `Host` names accepted behind a reverse proxy. Loopback is always accepted. |
| `NIT_GUI_PUBLIC_PORT` | Public Caddy port for `bin/frankfurt`, default `7792`. |
| `NIT_GUI_PUBLIC_HOST` | Public host printed by `bin/frankfurt`, default `92.5.143.242`. |
| `NIT_GUI_PUBLIC_PASSWORD` | Password for `bin/frankfurt`; otherwise reuse `/etc/caddy/Caddyfile`. |
| `--addr` | Listener address, default `127.0.0.1:7788`. |

If the service is down, the GUI still starts and shows an offline screen with a
retry button. Health is polled every 20 seconds.

## API

The browser only talks to these same-origin endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | `{ok, server, version}` from OpenCode `/api/info`. |
| `GET /api/config` | Directory, default model and primary agent. |
| `GET /api/projects` | Known projects from OpenCode `/api/project`, for the workspace picker. |
| `GET /api/sessions?dir=&children=true` | Newest sessions; `children=true` includes subagent sessions. |
| `POST /api/sessions` | Create `{directory, title?, agent?, model?}`. |
| `GET /api/sessions/{id}/messages` | Full transcript, ascending, paginated upstream, redacted. |
| `GET /api/sessions/{id}/children` | Subagent sessions with this parent. |
| `POST /api/sessions/{id}/prompt` | Send `{text, files?}`. |
| `POST /api/sessions/{id}/interrupt` | Stop the active execution. |
| `POST /api/sessions/{id}/revert` | Stage and commit a revert at `{messageID}`. |
| `POST /api/sessions/{id}/fork` | Fork before `{before?}`. |
| `POST /api/sessions/{id}/compact` | Compact the context. |
| `POST /api/upload?dir=&name=` | Raw file body, written through OpenCode `/api/experimental/fs/write`. |
| `POST /api/stt` | Raw 16 kHz mono WAV, transcribed by `whisper-cli`. |
| `POST /api/sessions/{id}/model` | Switch model `{model: {id, providerID, variant?}}`. |
| `POST /api/sessions/{id}/agent` | Switch agent `{agent}`. |
| `GET /api/models`, `GET /api/agents` | Pickers. |
| `GET /api/events` | Server-sent events proxied from OpenCode `/api/event`. |

OpenCode's plural resource paths are singular (`/api/session`, `/api/model`,
`/api/agent`, `/api/event`); the mapping is deliberate and lives in the backend.

## Security model

- The Go listener stays on loopback. `bin/frankfurt` puts a separate user Caddy
  with basic auth in front; it proxies only to `127.0.0.1:7791`. The app trusts a
  `Host` name only when it is loopback or listed in `NIT_GUI_ALLOWED_HOSTS`.
- The service password stays in the Go process and is not logged. OpenCode
  content can contain it because a tool can read `service.json`, so every
  pass-through JSON response from OpenCode and every SSE `data` payload is
  redacted before it is written to the browser. The current password,
  `opencode:<password>` and the base64 Basic auth value are replaced with
  `[redacted]`. Redaction walks JSON string values and re-encodes them, so the
  response stays valid JSON; SSE framing is preserved.
- `Host` is restricted to `localhost`, `127.0.0.1` and `::1`, case-insensitively.
  Cross-origin `POST` requests are rejected by checking `Origin` when present.
- JSON request bodies are capped at 1 MiB, uploads at 25 MiB and audio at 30 MiB.
  Upstream JSON responses are capped at 64 MiB. API requests have a 20 second
  upstream timeout; the event stream is exempt and is cancelled when the browser
  disconnects.
- Markdown is rendered by `react-markdown` without raw-HTML rehype. Model text,
  tool output and markdown elements are inserted as DOM text and elements, not as
  raw HTML. Raw HTML is never injected into the app DOM: an HTML-looking message,
  a fenced `html` block, or an unlabeled fence whose body is pure HTML gets a
  preview button, and the preview runs in
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
- The composer is a bottom dock overlay: growing it never resizes the transcript
  or the background canvas, and the transcript scrolls underneath it.
- Model and agent pickers in the header; changes are applied to the current
  session and remembered for the next new session. When the selected model
  exposes variants, a variant picker appears and the chosen `variant` is sent
  with the model ref; it is kept across model switches that support it.
- Running dot: driven by `session.execution.*` and `session.idle` events, and
  re-synced from `time.busy`/`time.idle` on every session-list load or reconnect.
  A local event newer than the list request wins, so a missed idle event cannot
  leave the dot stuck.
- Dark, light and system themes. Theme is stored in `localStorage`.
- The empty chat and the workspace picker draw slow contour lines with a copper
  accent (`--spark`). The lines bend toward the pointer and light up near it.
  Settings → Background picks `magnetic`, `split`, `ripple`, `diagonal` or
  `random` (one variant per new chat). The canvas pauses on a hidden tab and
  never intercepts pointer events.
- Settings → Chats sidebar switches between the header button and a hover
  reveal at the left screen edge. The reveal slides over the chat with a
  fade/settle animation and is stored in `localStorage`.
- Settings → Background switches that canvas between `Animated` and `Static`.
  `Static` draws one frame and still repaints when the pointer moves. The default
  follows `prefers-reduced-motion`; the choice is stored in `localStorage`.
- Shortcuts: `mod+k` search, `alt+n` new chat, `alt+j`/`alt+k` next/previous
  chat in the sidebar order, `enter` send and `shift+enter` newline (in the
  composer), double `esc` stop.
  Selecting text in the transcript shows a Quote button that drops it into the
  composer as a markdown quote.
- Layout: persistent or hover-revealed sidebar at 1280px and 900px,
  collapsible drawer on narrow screens; code blocks and tables scroll inside
  themselves, not the transcript.

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
| `nspell`, `dictionary-ru`, `dictionary-en` | Offline Hunspell spelling for the composer; dictionaries are served as assets and parsed in a worker. |

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
The dictionary licenses are served from `web/public/licenses`.

## Known limits

- Sessions are listed up to OpenCode's newest 100. Search filters that window
  client-side.
- A transcript is assembled from at most 20 upstream pages (100 messages each).
  Longer sessions are truncated at 2000 messages.
- No permission prompt UI, form/question UI, session deletion, shell panel, PTY
  or VCS panel yet.
- Dictation is transcribe-on-stop, not a live stream. It needs `whisper-cli` and
  `~/.local/share/whisper/ggml-large-v3-turbo-q5_0.bin` on the host that runs
  nit-gui; override with `NIT_GUI_WHISPER`, `NIT_GUI_WHISPER_MODEL` and
  `NIT_GUI_STT_LANG`.
- Spelling is spellcheck only: nspell does not catch real-word errors (`too` vs
  `to`), Russian `-тся/-ться` or punctuation. It loads about 4 MB of
  dictionaries in a worker; the first check can take a few seconds after start.
  Ignored words are kept in `nit-gui.spell-ignore` in `localStorage`.
- Uploaded files live under `/tmp` on the OpenCode host. Nothing cleans them up.
- No syntax highlighting in code blocks; copy and HTML preview are implemented.
- The HTML preview is a fixed-height iframe, not a full-window renderer.
- The Go app has no authentication of its own. `bin/frankfurt` puts basic auth
  in front of the public listener; any other remote exposure needs the same.

## Decisions

See [`docs/decisions.md`](docs/decisions.md).
