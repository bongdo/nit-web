# nit-gui

Web GUI for the OpenCode v2 service. Sessions on the left, transcript in the
middle, composer at the bottom. It is a client only: OpenCode remains the source
of truth for sessions, messages, models and agents.

Production has one **nit-gui** service, **Frankfurt**. It can front several
OpenCode servers, called instances, and the browser switches between them
without a second login. Everything that needs a model, dictionary, voice, JVM or
another background process runs on the nit-gui host. The browser is a thin
client: it renders the UI and plays audio. It is never assumed to have local TTS
voices, Hunspell dictionaries, LanguageTool or a GPU. Dictation belongs to the
client device: the composer is a plain textarea, so the OS or browser dictation
types into it.

`OpenCode` and `nit-gui` are required. Grammar, speech and server-side spelling
are optional capabilities; the Instances menu names the fallback for every one of
them.

## Runtime contract

| Capability | Runs on | State |
| --- | --- | --- |
| Authentication | nit-gui host, `/auth` + `nit_gate` cookie | one shared password and session for nit-gui, pero-gui and term-gui |
| Sessions, messages, models, agents | each OpenCode instance | source of truth |
| Instance list, SSH tunnels | nit-gui host, `~/.config/nit-gui/instances.json` | implemented |
| TTS | nit-gui keeps a warm host `piper` worker and streams its audio; browser voice is the fallback | implemented |
| Spelling | browser nspell worker today; target nit-gui `/api/spell` | migration gap |
| Drop | nit-gui host, `/nit/drop/` | files, static pages and folders; public links under `/nit/d/` |
| Grammar | nit-gui host LanguageTool sidecar through `/api/grammar` | optional |
| Attachments | the active instance, OpenCode `/api/experimental/fs/write` and `/tmp` | implemented |
| UI state (hidden, done, failed, drafts, model/agent) | nit-gui host, `~/.local/state/nit-gui/ui-state.json`, scoped by instance | shared across devices |

The supported client is a browser with audio output. Features must not depend on
local models, dictionaries, OS speech voices or a GPU.
Spelling is the remaining exception; see [Known limits](#known-limits).

## State

| Where | What |
| --- | --- |
| Each OpenCode instance | Sessions, messages, models, agents, working directories. |
| nit-gui on the host | Instance definitions and SSH tunnels; hidden chats, done/failed markers, drafts, preferred model and agent in `ui-state.json`, keyed by instance; the auth cookie is signed and stateless; uploads under
`/tmp`. |
| Browser `localStorage` | Device preferences: theme, sidebar mode, motion, background, spelling/autofix, notifications, scope, personal spelling dictionary. Workspace, recent workspaces and selected chat are per instance; the default instance keeps the old unscoped keys. Drafts are mirrored locally only as an instant-load cache. |
| Browser memory | Transcript cache (up to 12 MiB), running/waiting state, form state, current stream. |

The cache is deliberately local: it makes chat switching instant and is safe to
lose. Hidden chats, done/failed markers, drafts, model and agent are deliberately
on the server: they are the same on every device and scoped to the instance.
Theme, sidebar, motion, workspace and the selected chat stay local because they
describe the device you are sitting at.

## Instances

An instance is one OpenCode server behind this nit-gui. The nit-gui host stays
the same; switching an instance changes the OpenCode namespace: sessions,
workspaces, models, agents and the event stream. The menu header shows
`This app: nit-gui 2 — <host>` separately, so the app and the instance are not
confused. The same label is the browser tab title.

Open the menu from the network icon in the sidebar footer, `/instances`, or
Settings → Instances. The icon already carries the live/offline state; clicking
it is the instance picker. Each row shows the transport (`local`, `url`, `ssh`),
the OpenCode version and the state. The detail panel has three layers and a
capability row:

```
Browser      UI · audio · spelling (this device)
nit-gui      auth · proxy · drafts · grammar
OpenCode     sessions · models · agents · workspace · speech plugin
```

Capabilities are `on`, `fallback`, `off` or `unknown`. Optional capabilities are
never shown as errors: `off` names what still works. An offline instance shows
the reason and a `Reconnect` action; switching to another instance leaves it
untouched. If every instance is offline, the offline screen has `Switch instance`.

The menu edits the list: `New instance`, `Edit`, `Delete`, `Switch` and
`Reconnect`. Saving writes `instances.json` on the nit-gui host and reloads the
registry without a restart. A password typed in the form is written to a `0600`
file next to `instances.json`; it is never returned to the browser. Renaming an
instance moves its saved drafts, hidden chats and done/failed markers. Deleting
an instance keeps that state in `ui-state.json`, so recreating the same name
re-attaches it.

### Configuration

The file is `$NIT_GUI_INSTANCES` or
`${XDG_CONFIG_HOME:-$HOME/.config}/nit-gui/instances.json` on the nit-gui host.
Missing or empty means one auto-discovered local instance named `local`.

```json
{
  "instances": [
    { "name": "frankfurt", "url": "auto" },
    {
      "name": "riga",
      "ssh": "riga-dev",
      "dir": "/home/bongdo/Projects",
      "peroURL": "https://riga.example/pero/",
      "termURL": "/term/riga/"
    },
    {
      "name": "office",
      "url": "http://10.0.0.5:49374",
      "passwordFile": "~/.config/nit-gui/office.password"
    }
  ]
}
```

- `url: "auto"` uses the same discovery as before: `NIT_SERVER`,
  `OPENCODE_SERVER`, `OPENCODE_URL`, then `opencode service status`.
- `url` with an explicit endpoint needs `passwordFile` or inline `password` for
  a non-loopback host.
- `ssh` discovers the remote service, reads the remote OpenCode password and
  forwards a local port. It uses the `ssh` binary, not a Go SSH dependency.
- `dir` is the default workspace for a new instance. The workspace picker still
  lists the instance's own projects.
- `peroURL` and `termURL` are that machine's own editor and terminal, opened by
  the editor chips and the terminal link while the instance is active. Empty or
  missing means the host-wide `NIT_GUI_PERO_URL` / `NIT_GUI_TERM_URL` default.
  Each value is either an absolute `http(s)` URL without credentials or a path
  starting with `/` on the nit-gui origin.
- Names must match `^[A-Za-z0-9._-]{1,64}$` and be unique. The first instance is
  the default.
- Passwords stay on the nit-gui host. The browser never receives them. A config
  file with inline passwords should be mode `0600`; the app warns otherwise.
- A malformed file does not stop the app: it falls back to `local` and shows the
  error in the menu.

The instance menu writes `instances.json` and reloads the registry without a
restart; password files are re-read on a `401`. External edits to the file are
read on `Reconnect` or the next app start.

### Switching

Switching instances remounts the chat view: sessions, transcript cache, event
stream, models, agents and drafts are reloaded for the selected OpenCode server.
The previous instance keeps its own UI state, drafts and selected workspace.
There is one event stream for the active instance; inactive instances do not
keep background SSE connections.

## Run

```sh
./bin/run
```

Open <http://127.0.0.1:7788>. `bin/run` installs frontend dependencies if
needed, builds the web bundle when sources are newer, builds the Go binary and
serves it on loopback. This is local development, not a deployment. Local
`bin/run` has no login unless `NIT_GATE_PASSWORD` or `NIT_GATE_PASSWORD_HASH` is
set.

## Deploy

```sh
bin/auth        # once: generate the server password
bin/frankfurt   # build and restart the app and its local Caddy
bin/funnel      # once: public HTTPS through Tailscale Funnel
```

`bin/auth` writes `~/.config/nit-gui/auth.env` with mode `0600` and a
PBKDF2-SHA256 hash, then prints the password once. The same hash is the one
password and session key for nit-gui, pero-gui and term-gui: `bin/auth` in
`pero-gui` or `term-gui` rotates the same file. Rotate it with `bin/auth -force`
and restart the apps. `bin/funnel` runs the one-time `sudo tailscale funnel`
command that enables the public URL.

`bin/frankfurt` builds the web bundle with base `/nit/`, restarts the app on
`127.0.0.1:7791`, and starts a user Caddy on `127.0.0.1:7792`. Caddy is
loopback-only; Tailscale Funnel terminates HTTPS and exposes the app at
`https://frankfurt.tailf358cb.ts.net/nit/`. The app serves `/auth` and keeps a
signed HttpOnly SameSite=Lax `nit_gate` cookie on path `/` for 7 days. This is
the only login page: pero-gui and term-gui have none, verify the same cookie and
redirect unauthenticated pages to `/nit/auth?next=<absolute URL>`. The cookie is
not kept in memory, so a restart does not log you out; it is shared with
pero-gui and term-gui on the same host. Browsers still keep separate cookies for
the tailnet IP and the public hostname. Five wrong passwords block an IP for 15
minutes.

The box's public IP is `92.5.143.242`. The OCI security list does not expose
`80`/`7792`, and `443` is used by another service. The supported public path is
Tailscale Funnel; do not bind the app or Caddy to `0.0.0.0`.

When LanguageTool is configured (`NIT_GUI_LANGUAGETOOL` or
`languagetool-http-server` on `PATH`), `bin/frankfurt` also starts or reuses a
detached sidecar on `8180` and passes its URL to the app, so grammar stays warm
across app restarts.

`bin/nixos` and `bin/deploy nixos` remain in the tree for the old NixOS host.
That path is legacy and is not a supported production target; new features are
only verified on Frankfurt.

See [`docs/background-services.md`](docs/background-services.md) for the full
list of Frankfurt-side processes, ports, memory, startup order and the
public-link security checklist.

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

## Drop

`/nit/drop/` is the private manager inside the nit-gui process. It uses the
same `nit_gate` login. Published content lives under `/nit/d/`; the manager is
linked from the sidebar.

The agent publishes with the `drop` command, which is on `PATH` through
`bin/drop`:

```sh
drop ./report.html                 # a file
drop ./web/dist                    # a folder, served by index.html
drop ./vault --slug docs           # a readable folder URL
drop list
drop url d-0123456789abcdef
drop rm d-0123456789abcdef
drop slug d-0123456789abcdef docs-v2
drop access d-0123456789abcdef public
drop service ./app --slug app --public
drop start|stop|restart app
drop logs app -f
```

Every publication gets an id, a slug and a URL such as
`https://frankfurt.tailf358cb.ts.net/nit/d/<slug>/`. The URL is private by
default and lives forever. `--public` allows anonymous reads; `--expire 2w`
deletes it after two weeks. `drop slug` adds the old slug to aliases, so old
links keep working. Several selected files become one publication.

`drop service <dir>` publishes a long-lived application in a rootless podman
container. The directory needs a `Containerfile`/`Dockerfile` or a `drop.json`
with `{"image": "...", "port": 3000, "health": "/healthz", "cmd": [...]}`. The
manager builds and runs it, waits for the health check and prints
`/nit/d/<slug>/`. Containers publish only on `127.0.0.1` at a random port, are
named `drop-<slug>`, carry `nit.drop.id` labels and survive a nit-gui restart.
The proxy supports WebSocket, SSE and all HTTP methods, forwards
`X-Forwarded-Prefix`/`X-Forwarded-Proto`, and strips `nit_gate`, `Authorization`
and `X-Nit-*`. Applications must use relative URLs or honor the forwarded
prefix; absolute `/assets` paths are not rewritten. `drop start`, `drop stop`,
`drop restart`, `drop logs` and `drop rm` manage the container. `drop rm` never
deletes the source directory.

A publication with `index.html` is a static site: the root is the page itself
and its assets are served from the same path. A single file is served directly;
PDF and images are left to the browser. A folder without `index.html` gets a
bare file index. There is no iframe, preview card or Markdown reader. Markdown
and text entries in the manager link to `pero` with `?open=<absolute path>`;
the raw file link stays available. The agent instructions in `AGENTS.md` say to
use `drop` whenever the user should see a page, a full app or a file.

Old `/nit/drop/e/<id>/`, `/nit/drop/files/<id>/...`,
`/nit/drop/download/<id>/...` and `?file=` URLs redirect to the canonical
`/nit/d/` path.

Storage is `$NIT_DROP_ROOT` or `~/.local/share/nit-gui/drop`, one private
directory per entry with `entry.json`. Entries with the old seven-day default
become permanent on read; explicit 1h/24h/30d expiries remain. Expired entries
are removed when the list or a public path is read.

`NIT_DROP_ROOT` moves the store. `NIT_DROP_MAX_UPLOAD` changes the upload limit
in bytes. `NIT_DROP_PODMAN` selects the podman binary (default `podman`).
`NIT_DROP_BASE_PATH` is passed to containers as a convenience; the proxy always
sends the authoritative `X-Forwarded-Prefix`. `DROP_PUBLIC_BASE` is used by the CLI only; `bin/drop` defaults it to
the public `/nit/d/` URL.

## Workspaces

Every chat belongs to one directory for its whole lifetime; it cannot be moved
later. On first start the GUI asks for a workspace and remembers it in
`localStorage`. The picker browses the server's folders with breadcrumbs and a
parent button and completes absolute paths as you type. The folder is checked
live: a missing path is reported before you use it.

The sidebar has three scopes:

| Scope | Shows |
| --- | --- |
| `This project` | chats created in the current workspace. |
| `All chats` | every top-level chat with a primary agent, across workspaces. |
| `All machines` | the same chats from every connected instance, merged and still grouped by directory. |

In `All machines` every row carries its instance name in a small pill. The merged
list is fetched when the scope first opens and refreshed on reconnect, then
cached for the session. Opening a chat from another instance switches to that
instance first. Group headers are not clickable there: switch instances before
starting a chat in another machine's directory.

In a cross-project scope, chats that finished or wait for an answer rise above
the project groups as one unlabelled block; each row names its project. The rest
stay grouped by directory, and running chats keep their dock at the bottom.

Each chat row shows its own subagent counter on the directory line and expands
only that chat's subagents. In the `This project` scope the tab shows the workspace
name and the card omits the directory. The selected chat's `N subagents` menu
opens the same transcripts, and the parent header has `Back to parent`.

Every chat in the scope is listed; the sidebar walks every upstream page of
sessions before the first paint, so the whole history is in the list. Search
goes upstream instead of filtering the loaded window.

`New chat` does not create a session. The session is created in the current
workspace on the first Send, so an empty draft never appears in the list.
Hidden chats, done/failed markers, drafts, model and agent are stored by the
server, so hiding a chat or continuing a draft works on the next device.

## Composer and message actions

- The textarea grows to 200 px and then scrolls inside itself.
- Each chat keeps its own unsent draft on the server, mirrored locally for
  instant load; switching chats, reloading or opening another device restores
  it. The new-chat draft is separate per workspace. Unsent attachments are not
  kept when you switch chats.
- Typing anywhere focuses the composer and keeps the first key, unless a
  dialog/menu is open or another field already has focus.
- `/` opens the command palette: `/new`, `/dir`, `/compact`, `/revert`, `/fork`,
  `/retry`, `/theme`, `/clear`, `/help`. Commands run in the client; they are
  never sent to the model.
- Attach files with the paperclip, clipboard paste or drag and drop. The file is
  written to the OpenCode host through `/api/experimental/fs/write` and attached
  as `files: [{uri, name}]` on the next prompt. The limit is 20 MiB, matching
  OpenCode. You can send files without any text.
- The transcript shows images and GIFs inline, audio and video with native
  players, PDFs as a card with a browser PDF preview, and every other file as a
  download card. Cards use icons for images, PDF, audio, video, archives,
  spreadsheets, presentations, documents, JSON, code and keys.
- Local file links in assistant markdown (`/api/file?...`) get the same cards,
  players and icons, so a reply can carry attachments too.
- Text, images and PDFs are the types OpenCode forwards to the model; other files
  are uploaded but the model never receives them, so the composer marks them
  with a warning.
- The selected model must accept the input type. The composer warns when the
  current model cannot read an image or PDF; pick a model whose capabilities
  include `image` or `pdf` (for example Gemini or Claude for PDFs).
- Dictation is not a nit-gui capability. The composer is a normal `<textarea>`,
  so the system keyboard's dictation (Gboard, Windows voice typing, macOS
  Dictation) or a browser extension types into it. Audio stays on the device and
  better STT can be added by the client without a server change.
- Spelling is checked by an nspell worker in the browser for Russian and
  English today. Misspelled words are red with a wavy underline; put the caret
  in a word (or click it) and a gray `→ ...` chip shows replacements next to
  it. Click a suggestion to apply it, or `ignore` to add the word to your
  dictionary. `Esc` hides the chip, and Settings → Spelling & grammar turns
  both checks off. On a touch screen the composer skips the custom underline
  and the chip and leaves spelling to the system keyboard, so there is no
  overlap with its suggestions. Code blocks, inline code, URLs, paths, file
  names and known
  project terms are skipped. This is the last capability that still runs on
  the client; it is scheduled to move behind `/api/spell` on Frankfurt.
- Grammar is optional: when a LanguageTool sidecar is configured on Frankfurt,
  the same chip also shows punctuation and real-word fixes (`too` → `to`) from
  the host's Java process. Without it, only spelling runs. The draft goes to
  that host process, never to a cloud service.
- Speech output uses the host. The reply `Read` button speaks through the
  host: `piper` streams raw audio sentence by sentence, so the first sound
  arrives in about a second instead of after the whole reply. If piper is
  unavailable, nit-gui falls back to whole-file piper, then the OpenCode TTS
  hub, then the browser `speechSynthesis`. Markdown is rewritten for
  speech: code blocks become “Блок кода на Go, 12 строк”, paths become “файл
  tts.go в папке internal server”, URLs keep only their host, tables are
  summarized and hashes are skipped. Select text in a reply and press `Read`
  to start from that selection.
- Obvious lowercase typos are fixed after a space when exactly one suggestion is
  one edit away. Backspace at the end of the corrected word, or `Ctrl/Cmd+Z`,
  restores the original and adds it to the ignore list so it is not fixed
  again. Ambiguous, capitalized, code and path words are never auto-fixed;
  Settings → Auto-fix typos turns this off.
- The personal dictionary grows from `ignore`, from undoing an auto-fix, and
  from words you send three times while they are still flagged. This is how
  project terms and names stop being underlined.
- A permission request from the agent appears as a card above the composer:
  `Allow once`, `Always` or `Reject`, with an optional rejection reason. A
  request in a background chat shows the waiting marker and desktop
  notification; open that chat to answer. Denying or allowing is never
  automatic.
- Hover a user message for Copy, Revert and Fork. Revert commits the revert and
  puts the message text back into the composer; Fork opens a new session before
  that message. The composer also has a fast `Undo` button for the last prompt.
- The chat header shows `N subagents` with active and finished children; click
  one to open its transcript and `Back to parent` to return.

## Discovery and environment

Each instance is resolved on the nit-gui host. A local or `url: "auto"` instance
uses the same discovery as the `nit` TUI:

1. `NIT_SERVER`, then `OPENCODE_SERVER`, then `OPENCODE_URL`.
2. Otherwise `opencode service status`.
3. The password comes from `${XDG_CONFIG_HOME:-$HOME/.config}/opencode/service.json`.

An explicit `url` instance uses that endpoint and its `passwordFile` or inline
`password`; a remote URL without either is rejected. An `ssh` instance runs
`opencode service status` and reads `service.json` on the remote host, then opens
a local port forward with the `ssh` binary.

Requests use Basic auth `opencode:<password>`. `0.0.0.0` / `::` status URLs are
rewritten to loopback. Credentials in a server URL are discarded.

| Variable | Meaning |
| --- | --- |
| `NIT_SERVER` | Explicit OpenCode server URL. |
| `OPENCODE_SERVER` | Same, OpenCode-native name. |
| `OPENCODE_URL` | Same, supported for parity with `nit`. |
| `XDG_CONFIG_HOME` | Used to locate `opencode/service.json` and `nit-gui/instances.json`. |
| `NIT_GUI_INSTANCES` | Path to `instances.json`, default `$XDG_CONFIG_HOME/nit-gui/instances.json`. |
| `NIT_GUI_ALLOWED_HOSTS` | Comma-separated extra `Host` names accepted behind a reverse proxy. Loopback is always accepted. |
| `NIT_GUI_PUBLIC_PORT` | Caddy port for `bin/frankfurt`, default `7792`. |
| `NIT_GUI_PUBLIC_HOST` | Public Funnel host; also marks requests for Secure cookies and HSTS. |
| `NIT_GUI_BASE_PATH` | External path prefix, default `/nit` in `bin/frankfurt`. |
| `NIT_GUI_PERO_URL` | Base URL for pero links, default `/pero/`. |
| `NIT_GUI_TERM_URL` | Base URL for term links, default `/term/`. |
| `NIT_GUI_AUTH_ENV` | Auth env file sourced by `bin/frankfurt`, default `~/.config/nit-gui/auth.env`. |
| `NIT_GATE_PASSWORD_HASH` | Shared PBKDF2-SHA256 hash used by nit-gui, pero-gui and term-gui. Set by `bin/auth`. |
| `NIT_GATE_PASSWORD` | Plain shared password for local development; hashed at startup. Do not use in production. |
| `NIT_GUI_PASSWORD_HASH` | Old name for `NIT_GATE_PASSWORD_HASH`, still accepted. |
| `NIT_GUI_PASSWORD` | Old name for `NIT_GATE_PASSWORD`, still accepted. |
| `NIT_GUI_STATE` | Path to `ui-state.json`, default `$XDG_STATE_HOME/nit-gui/ui-state.json` or `~/.local/state/nit-gui/ui-state.json`. |
| `NIT_DROP_ROOT` | Drop store, default `~/.local/share/nit-gui/drop`. |
| `NIT_DROP_MAX_UPLOAD` | Browser upload limit in bytes, default `134217728` (128 MiB). |
| `DROP_PUBLIC_BASE` | Public base printed by `bin/drop`, default `https://frankfurt.tailf358cb.ts.net/nit/d/`. |
| `NIT_GUI_LANGUAGETOOL` | Path to `languagetool-http-server`; the app starts it lazily. |
| `NIT_GUI_LANGUAGETOOL_URL` | Use an already running LanguageTool server instead of spawning one. |
| `NIT_GUI_LANGUAGETOOL_PORT` | Spawned server port, default `8179`. |
| `NIT_GUI_LANGUAGETOOL_JAVA_OPTS` | JVM options, default `-Xms256m -Xmx512m`. |
| `NIT_GUI_TTS_URL` | OpenCode TTS hub, default `http://127.0.0.1:7787`. |
| `NIT_GUI_TTS_TOKEN_FILE` | Hub token file, default `$XDG_STATE_HOME/opencode-tts/token` or `~/.local/state/opencode-tts/token`. |
| `NIT_GUI_TTS_TOKEN` | Direct hub token, overrides the token file. |
| `NIT_GUI_TTS` | Set to `off` to disable host TTS. |
| `NIT_GUI_TTS_ENGINE` | Host voice: `auto` (default), `piper` or `off`. |
| `NIT_GUI_TTS_PIPER` | `piper` binary, default on `PATH`. |
| `NIT_GUI_TTS_PIPER_MODEL` | Piper voice, default `$XDG_DATA_HOME/piper-voices/ru_RU-irina-medium.onnx` or `~/.local/share/piper-voices/...`. |
| `NIT_GUI_TTS_RATE` | Speech rate, default `1.0`. |
| `NIT_GUI_WARM` | Set to `0` to skip eager LanguageTool and host-voice warmup. |
| `--addr` | Listener address, default `127.0.0.1:7788`. |

TTS has four paths, in order:

1. **Warm host voice.** The reply `Read` button splits the reply into
   paragraphs and sentences and calls `POST /api/tts/stream` for each segment.
   The server rewrites Markdown for speech and asks the warm `piper` worker for
   the segment WAV, then forwards its 16-bit mono PCM. The browser schedules
   the PCM through Web Audio, so the first words start in about 0.5–1.7
   seconds. The next segment is synthesized while the current one plays.
2. **Whole-file host voice.** If piper is missing or streaming is unsupported,
   nit-gui synthesizes the whole reply with piper and returns a WAV file.
   `auto` uses piper; `NIT_GUI_TTS_ENGINE` forces piper or `off`.
3. **Hub with an audio client.** If the host has no voice, publish to the
   OpenCode TTS hub; the hub plays it on the user's audio client. The token
   never reaches the browser.
4. **Device voice.** If none of the host paths work, the browser's
   `speechSynthesis` is the labeled fallback. If the browser has no voice,
   speech is `off`.

The Instances menu shows host speech as `on` when either host path works,
`fallback` when only the device voice is left, and `off` otherwise. `piper` is
local. A warm worker keeps the ~63 MB model in memory after the first request;
a 370-character reply synthesizes in about 3 seconds, with the first audio at
about 0.5–1.7 seconds. The worker is started during server warmup and survives
until the server restarts.

If the active instance is down, the GUI still starts and shows an offline screen
with a retry button and a `Switch instance` action. Health is polled every 20
seconds for the active instance.

## API

The browser only talks to these same-origin endpoints:

All `/api` endpoints except `/api/instances*` accept `X-Nit-Instance: <id>` or
`?instance=<id>` and default to the first configured instance. `EventSource` and
`<img>` links use the query parameter because they cannot set headers.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | `{ok, instance, server, version}` from OpenCode `/api/info`. |
| `GET /api/instances` | App identity, default instance, config path/error and every instance with its capabilities, `url`, `ssh` and default directory. `?probe=all` also connects idle SSH instances. |
| `POST /api/instances` | Create or edit `{original?, name, transport, url?, ssh?, dir?, password?, passwordFile?}`. Writes the config on the host and reloads the registry. |
| `DELETE /api/instances/{id}` | Remove an instance; the last one cannot be removed. |
| `POST /api/tts` | `{text}`; publish to the host TTS hub. `503` when the hub is down or has no audio client. |
| `POST /api/tts/audio` | `{text}`; synthesize the whole reply with piper and return WAV. |
| `POST /api/tts/stream` | `{text}`; stream 16-bit mono PCM from `piper` as it is synthesized. `X-Audio-Rate` carries the sample rate. |
| `POST /api/tts/stop` | Stop playback on the host audio client. |
| `GET /api/config` | Directory, default model and primary agent. |
| `GET /api/projects` | Known projects from OpenCode `/api/project`, for the workspace picker. |
| `GET /api/fs?path=` | Immediate subfolders of an absolute path (default: OpenCode's working directory), via OpenCode `/api/fs/list`. `404` when the folder does not exist. |
| `GET /api/sessions?dir=&children=true&search=&cursor=` | Newest sessions; `children=true` includes subagent sessions; `search` and `cursor` go upstream; the response keeps OpenCode's `cursor`. |
| `POST /api/sessions` | Create `{directory, title?, agent?, model?}`. |
| `DELETE /api/sessions/{id}` | Delete a session and its child sessions. |
| `GET /api/sessions/{id}` | One session, used to restore a selected subagent after reload. |
| `GET /api/sessions/{id}/messages` | Full transcript, ascending, paginated upstream, redacted. `light=1` returns only the visible transcript: user messages, assistant text, `question` tools and compaction, with `steps`/`tools`/`errors` counters instead of tool and reasoning parts. `limit=N` returns the newest N; `before=` loads the previous page. |
| `GET /api/sessions/{id}/messages/{messageID}` | One full message, used to load tool output or reasoning on demand. |
| `GET /api/sessions/{id}/children` | Subagent sessions with this parent. |
| `GET /api/sessions/{id}/permissions` | Pending permission requests for this session. |
| `POST /api/sessions/{id}/permissions/{requestID}/reply` | `{decision: "once"\|"always"\|"reject", message?}`. |
| `POST /api/sessions/{id}/prompt` | Send `{text, files?}`. |
| `POST /api/sessions/{id}/interrupt` | Stop the active execution. |
| `POST /api/sessions/{id}/revert` | Stage and commit a revert at `{messageID}`. |
| `POST /api/sessions/{id}/fork` | Fork before `{before?}`. |
| `POST /api/sessions/{id}/compact` | Compact the context. |
| `POST /api/upload?dir=&name=` | Raw file body up to 20 MiB, written through OpenCode `/api/experimental/fs/write`. |
| `POST /api/grammar` | `{text}`; optional LanguageTool grammar/punctuation check on the nit-gui host. |
| `POST /api/sessions/{id}/model` | Switch model `{model: {id, providerID, variant?}}`. |
| `POST /api/sessions/{id}/agent` | Switch agent `{agent}`. |
| `GET /api/models`, `GET /api/agents` | Pickers. |
| `GET /api/ui` | Shared `{hidden, status, model, agent}` UI state for the active instance. |
| `POST /api/ui/hidden` | `{ids, hidden}`; hide or unhide chats. |
| `GET /api/ui/drafts?key=` | Read one shared draft with its `updatedAt` and `cleared` flag. |
| `POST /api/ui/drafts` | `{key, text}`; save or clear a shared draft. A clear keeps a tombstone so other devices drop their stale copy. |
| `POST /api/ui/model` | `{model}`; save the preferred model. |
| `POST /api/ui/agent` | `{agent}`; save the preferred agent. |
| `POST /api/ui/sessions/{id}/status` | `{status}`: `done`, `failed` or empty (seen). |
| `DELETE /api/ui/sessions/{id}` | Remove hidden/status/draft state for a deleted chat. |
| `GET /api/events?instance=` | Server-sent events proxied from the active OpenCode `/api/event`. |

All `/api` endpoints require the session cookie. `/auth` is the only
unauthenticated page; `/auth/logout` is a POST that clears the session.
OpenCode's plural resource paths are singular (`/api/session`, `/api/model`,
`/api/agent`, `/api/event`); the mapping is deliberate and lives in the backend.

`POST /api/spell` is the planned nit-gui-side replacement for the browser
nspell worker. It is not implemented yet.

## Security model

- Production is one nit-gui service on Frankfurt; it fronts one or more OpenCode
  instances. The browser is untrusted and thin: it gets only the same-origin
  API, never host files, service credentials, model paths or a local shell.
- The Go listener stays on loopback. `bin/frankfurt` starts Caddy on
  `127.0.0.1:7792`; Tailscale Funnel terminates public TLS. The app trusts a
  `Host` name only when it is loopback or listed in `NIT_GUI_ALLOWED_HOSTS`.
- Every route except `/auth` and public drop content under `/d/` requires a
  session cookie. The login page uses a
  PBKDF2-SHA256 hash (600k rounds), an HttpOnly Secure SameSite=Lax `nit_gate`
  cookie on path `/`, no-store and a strict CSP. The cookie is an HMAC-signed
  expiry, so it survives restarts and is accepted by pero-gui and term-gui on
  the same hostname; it expires after 7 days. Five wrong passwords block the
  source IP for 15 minutes; 50 failures across all clients block new logins for
  5 minutes. Password values are never logged or put in a URL. pero-gui and
  term-gui have no login page: they verify the same cookie and redirect
  unauthenticated pages to `/nit/auth?next=<absolute URL>`. The absolute return
  target is accepted only for http/https URLs on the same hostname with a path
  under `/nit/`, `/pero/` or `/term/`.
- Drop's manager and all writes are behind the same cookie. `/nit/d/` is the
  only unauthenticated path: it serves an entry only when that entry was
  explicitly made public; a private entry returns 404. Uploads are written only
  below `NIT_DROP_ROOT`; ids, slugs and relative paths are validated,
  `entry.json` is reserved. Public HTML is served with
  `Content-Security-Policy: sandbox`, an opaque origin, no `fetch`/XHR/WebSocket
  (`connect-src 'none'`) and no form submission, so it cannot call the nit-gui
  API. External images and scripts are not blocked; make an entry public only
  when you trust its contents. A publication is permanent by default and can
  be set to expire after two weeks.
- Instance passwords stay in the Go process and in `instances.json`; they are
  never logged or sent to the browser. SSH hosts are sent only as the sanitized
  connection identifier the editor needs.
  `GET /api/instances` exposes only the name, transport, sanitized URL, SSH
  host, default directory, version and state. Passwords and password-file
  contents are never returned. The config file should be mode `0600` when it
  contains an inline password; the app warns otherwise. The editor writes a
  typed password to a separate `0600` file. `X-Nit-Instance` and `?instance=`
  are validated against the configured names; an unknown name is rejected with
  `400`.
- OpenCode content can contain a service password because a tool can read
  `service.json`, so every pass-through JSON response from OpenCode and every
  SSE `data` payload is redacted before it is written to the browser. For the
  active instance, `opencode:<password>` and the base64 Basic auth value are
  replaced with `[redacted]`. Redaction walks JSON string values and re-encodes
  them, so the response stays valid JSON; SSE framing is preserved.
- `Host` is restricted to `localhost`, `127.0.0.1` and `::1`, case-insensitively.
  Cross-origin `POST` requests are rejected unless `Origin` matches `Host`,
  `X-Forwarded-Host` or `NIT_GUI_PUBLIC_HOST`. The login form and authenticated
  requests also accept `Origin: null`, which some privacy browsers and
  extensions send; unauthenticated API requests do not.
- Responses set `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, COOP/CORP, and HSTS on the public host. Caddy
  repeats the safe subset.
- JSON request bodies are capped at 1 MiB and uploads at 20 MiB. Upstream JSON
  responses are capped at 64 MiB. API requests have a 20 second upstream timeout;
  the event stream is exempt and is cancelled when the browser disconnects.
- Markdown is rendered by `react-markdown` without raw-HTML rehype. Model text,
  tool output and markdown elements are inserted as DOM text and elements, not as
  raw HTML. Raw HTML is never injected into the app DOM: an HTML-looking message,
  a fenced `html` block, or an unlabeled fence whose body is pure HTML gets a
  preview button, and the preview runs in
  `iframe srcdoc` with `sandbox="allow-scripts allow-forms allow-modals"`.
  `allow-same-origin` is absent, so preview scripts run in an opaque origin and
  cannot read the app, cookies or local storage. Preview code can still make
  network requests, so treat it as untrusted content.
- There is one shared password for nit-gui, pero-gui and term-gui, no per-user
  accounts, database, telemetry or analytics. The signed session cookie survives
  restarts and expires after 7 days.

## Frontend behaviour

- Sidebar: search, new session, title, directory, relative age, running dot,
  and a per-chat subagent counter that expands that chat's subagents.
- The sidebar network icon opens the Instances menu: transport, state, OpenCode
  version, the Browser → nit-gui → OpenCode flow and a capability row for every
  instance. The same icon carries the live/offline state. `/instances` opens the
  same menu. Switching remounts the chat view, so the new instance starts from
  its own sessions and drafts. Offline and boot screens also have `Switch
  instance`. The menu creates, edits and deletes instances; saving writes
  `instances.json` on the host.
- Streaming text, reasoning, tool calls collapsed by default, code copy,
  GFM tables/task lists.
- Composer: Enter sends, Shift+Enter adds a line, stop while streaming, token
  and cost footer when OpenCode reports them. On a touch screen Enter only adds
  a line and the Send button is the only way to send. While the agent is
  running, a new
  message is steered in at the next step boundary (after the current tool call)
  instead of waiting for the whole run to finish.
- The composer is a bottom dock overlay: growing it never resizes the transcript
  or the background canvas, and the transcript scrolls underneath it.
- Model and agent pickers in the header; changes are applied to the current
  session and remembered on the server for the next new session on any device.
  When the selected model
  exposes variants, a variant picker appears and the chosen `variant` is sent
  with the model ref; it is kept across model switches that support it.
- Header workspace links open the current session directory in `term` (`?dir=`)
  and `pero` (`?open=`) in a new tab. They are shown for the local instance;
  `NIT_GUI_TERM_URL` and `NIT_GUI_PERO_URL` set the bases.
- Running dot: driven by `session.execution.*` and `session.idle` events, and
  re-synced from `time.busy`/`time.idle` on every session-list load or reconnect.
  A local event newer than the list request wins, so a missed idle event cannot
  leave the dot stuck.
- Stock light and dark themes plus Nord, Solarized, Gruvbox, Dracula, Paper,
  Paper Dark, Ember, Kiln, Mist, Ash and Ash Dark, or follow the system. `/theme`
  opens the picker. Theme is stored in `localStorage`.
- Settings → Sign out posts to `/auth/logout` and clears the session cookie.
- The empty chat and the workspace picker draw slow contour lines with a copper
  accent (`--spark`). Settings → Background picks `spotlight`, `magnetic`,
  `split`, `ripple`, `diagonal` or `random` (one variant per new chat).
  `spotlight` is the default: it draws only the disc around the pointer and
  stops its frame loop when the pointer leaves. The rest bend toward the pointer
  and light up near it. The canvas pauses on a hidden tab and never intercepts
  pointer events.
- Settings → Chats sidebar switches between the header button and a hover
  reveal at the left screen edge. The reveal slides over the chat with a
  fade/settle animation and is stored in `localStorage`.
- Settings → Background switches that canvas between `Animated` and `Static`.
  `Static` draws one frame and still repaints when the pointer moves. The default
  follows `prefers-reduced-motion`; the choice is stored in `localStorage`.
- Shortcuts: `mod+k` search, `alt+n` new chat, `tab`/`shift+tab` (or
  `alt+j`/`alt+k`) next/previous chat in the sidebar order, `alt+←`/`alt+→`
  switches the scope This project / All chats / All machines, `enter` send and
  `shift+enter`
  newline (in the composer), double `esc` stop.
  In a text field `tab` belongs to the field: the composer completes the
  selected `/command` and accepts the first spelling or grammar suggestion.
  `tab` is not hijacked while a dialog or an agent form is focused.
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
| `nspell`, `dictionary-ru`, `dictionary-en` | Browser spelling today; target is server-side `/api/spell`, after which these leave the bundle. |

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

Grammar checking is optional and separate from the npm dependencies. It runs
on Frankfurt as a LanguageTool 6.x HTTP server: either point
`NIT_GUI_LANGUAGETOOL_URL` at a running `languagetool-http-server`, or set
`NIT_GUI_LANGUAGETOOL` to its binary and the app starts it on the first grammar
request. It needs Java 17 or newer, about 0.7 GB RSS after Russian and English
are warm, and about 0.5 GB of disk for LanguageTool plus the JRE. Without it,
the composer only checks spelling. The browser never talks to LanguageTool
directly.

The app warms LanguageTool at startup, so the first check in a running app is
not a cold start. To keep LanguageTool alive across
app restarts as well, start it separately:

```sh
NIT_GUI_LANGUAGETOOL=/path/to/languagetool-http-server bin/languagetool
NIT_GUI_LANGUAGETOOL_URL=http://127.0.0.1:8179 bin/frankfurt
```

`bin/languagetool` detaches the server, waits for `/v2/languages`, and warms
Russian and English before returning. Set `NIT_GUI_WARM=0` to skip the app's
own startup warmup.

## Known limits

- The sidebar loads all upstream session pages (100 each, capped at 10,000) on
  every refresh, so a large instance costs several requests per reload. A
  search query goes upstream instead of filtering that window client-side.
- The UI opens the full visible transcript; tool and reasoning payloads load
  when a steps block is opened. The full endpoint is assembled from at most 100
  upstream pages (100 messages each); longer sessions are truncated at 10,000
  messages.
- No shell panel, PTY or VCS panel yet.
- Permission requests are a card in the composer: `Allow once`, `Always` or
  `Reject`, with an optional reason. A request in a background chat marks that
  chat as waiting and notifies you; switch to it to approve.
- There is one production nit-gui on Frankfurt, and every visitor shares the
  same set of OpenCode instances, sessions and workspace namespaces. There are
  no per-user accounts or quotas; an instance is a separate OpenCode namespace,
  not a security boundary.
- The menu edits `instances.json` and reloads the registry without a restart.
  External edits to the file are read on `Reconnect` or the next app start. SSH
  tunnels are not reconnected automatically: use `Reconnect` or switch to the
  instance again.
- Only the active instance keeps an event stream. Inactive instances do not
  accumulate unread counts or approvals in the background; switching to one
  reloads its list and transcript.
- `All machines` fans out one request per connected instance on first open and on
  reconnect. There is no multi-instance event stream, so other machines' lists
  are a snapshot and hidden/done/failed markers plus drafts come from the active
  instance only; hide or delete a foreign chat after switching to it.
- Drafts, hidden chats and done/failed markers are scoped by instance. The
  default instance keeps the old unscoped `localStorage` keys; other instances
  use a `:<instance>` suffix.
- Dictation belongs to the client. The composer has no mic button: use the
  system keyboard's dictation or a browser extension. A future server-side STT
  can come back as an optional capability without changing the composer.
- Spelling still runs in a browser worker. It is the remaining client-side
  capability: a thin browser without Web Workers or the ~4 MB dictionaries gets
  no spelling until `/api/spell` lands on Frankfurt. It is spellcheck only:
  nspell does not catch real-word errors (`too` vs `to`), Russian `-тся/-ться`
  or punctuation. Ignored words are kept in `nit-gui.spell-ignore` in
  `localStorage`.
- Auto-fix is deliberately conservative: lowercase words only, one edit away,
  exactly one candidate, not in code or a path. `хочю` stays for the chip
  because `холю`, `хорю` and `хочу` are equally close. Backspace at the end of
  the corrected word or `Ctrl/Cmd+Z` restores it; words sent three times while
  still flagged are learned automatically.
- Grammar is optional and slower: LanguageTool on Frankfurt warms up on the
  first request (3–4 s), then Russian checks take about 250 ms and English
  about 30–40 ms. Capitalization and spelling rules are disabled so the
  composer does not duplicate nspell; some Russian commas are still missed.
- Host TTS streams from `piper` by default: the reply is split into paragraphs
  and sentences, the server rewrites Markdown for speech and forwards raw PCM,
  and the browser schedules it as it arrives. The first audio usually starts in
  about a second, and the next segment is synthesized while the current one
  plays. Code blocks are announced by language and size, paths by file and
  folder, URLs by host; tables are summarized and long hashes are skipped.
  Whole-file piper remains the fallback. With neither host path, the browser
  voice is the labeled fallback; with no browser voice, speech is `off`.
- The TTS hub still listens on `0.0.0.0:7787`; only the token protects it. Bind
  it to `127.0.0.1` when the host is exposed beyond the tailnet.
- Attachments are uploaded when you press Send, not when you select them, so an
  unsent or removed file never reaches the host. Sent files live under
  `/tmp/nit-gui-*` on the OpenCode host; nothing cleans them up, because old
  transcripts still preview them. Only those paths can be served back through
  `/api/file`.
- PDF support depends on the model. The default DeepSeek model reads images but
  not PDFs; Gemini and Claude models advertise PDF input. The composer warns
  before sending a file the current model cannot read.
- No syntax highlighting in code blocks; copy and HTML preview are implemented.
- The HTML preview is a fixed-height iframe, not a full-window renderer.
- UI state is last-write-wins in one JSON file. Clients refresh it on focus and
  every 10 seconds; there is no push channel. A done marker is only created by
  an open client that receives the idle event, so a completion while every
  client is closed is not marked unseen later.
- Drafts are capped at 256 KiB each and saved 700 ms after the last edit. Two
  devices editing the same draft overwrite each other; the newest save wins.
- Authentication is one shared password, not per-user accounts. Sessions and
  lockout counters are in memory, so an app restart signs everyone out and
  clears blocks. The public path is Tailscale Funnel; exposing the app another
  way requires TLS and the same auth in front.

## Decisions

See [`docs/decisions.md`](docs/decisions.md).
