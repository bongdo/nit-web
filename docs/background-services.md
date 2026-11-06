# Background services for a server-only deployment

Notes for a future packaging pass: what has to stay running, what is optional,
what it costs, and what is still missing for a public link. Today the app is
loopback-first; this document does not change that.

## Current topology

| Service | Address | Role | Required |
| --- | --- | --- | --- |
| OpenCode | `127.0.0.1:49374` (varies) | Sessions, messages, models, agents, provider credentials | yes |
| nit-gui | `127.0.0.1:7791` | Go API + embedded web bundle + spelling dictionaries | yes |
| Caddy | `:7792` | Public listener, basic auth, reverse proxy | for public access |
| LanguageTool | `127.0.0.1:8180` | Grammar and real-word checks | optional |
| `whisper-server` | `127.0.0.1:8178` | Fast dictation while recording | optional |
| `whisper-cli` | none | Accurate dictation, one process per request | optional |
| nspell | browser worker | Local spelling, no server process | always in the browser |
| OpenCode TTS plugin | `0.0.0.0:7787` | Speech hub for the TTS tool | not part of nit-gui |

MCP servers, shells and PTYs belong to OpenCode. They are not managed by
nit-gui.

## Startup order

1. OpenCode service.
2. LanguageTool and `whisper-server` (they can start in parallel).
3. nit-gui.
4. Caddy.

The Go app now warms LanguageTool and fast dictation at startup. If
LanguageTool is started as a detached sidecar (`bin/languagetool`), it can
start before the app and survive app restarts. Caddy should only be exposed
after the app health check passes.

## Resource budget

| Item | Approximate |
| --- | --- |
| nit-gui process | 25–40 MB RSS |
| LanguageTool JVM | 0.6–0.7 GB RSS after RU+EN warm; 256 MB heap minimum |
| LanguageTool package + JRE | ~0.5 GB (Nix closure ~0.8 GB) |
| Fast Whisper model | 182 MB (`ggml-small-q5_1.bin`) |
| Accurate Whisper model | 548 MB (`ggml-large-v3-turbo-q5_0.bin`) |
| nspell dictionaries | ~4 MB embedded in the web bundle |
| Caddy | ~20 MB |

Four cores are enough for one user. Russian grammar checks are about 250 ms,
English about 30–40 ms after warmup. Fast dictation segments are much cheaper
than the accurate one-shot pass.

## Configuration

| Variable | Used by |
| --- | --- |
| `NIT_SERVER`, `OPENCODE_SERVER`, `OPENCODE_URL` | nit-gui discovery |
| `XDG_CONFIG_HOME` | OpenCode `service.json` password |
| `NIT_GUI_ALLOWED_HOSTS` | extra `Host` names behind a reverse proxy |
| `NIT_GUI_LANGUAGETOOL` | path to `languagetool-http-server`; app spawns it |
| `NIT_GUI_LANGUAGETOOL_URL` | use an already running LanguageTool |
| `NIT_GUI_LANGUAGETOOL_PORT` | spawned LanguageTool port, default `8179` |
| `NIT_GUI_LANGUAGETOOL_JAVA_OPTS` | JVM options, default `-Xms256m -Xmx512m` |
| `NIT_GUI_WHISPER_SERVER` | fast dictation server binary |
| `NIT_GUI_STT_FAST_MODEL` | fast model path |
| `NIT_GUI_WHISPER`, `NIT_GUI_WHISPER_MODEL`, `NIT_GUI_STT_LANG` | accurate dictation |
| `NIT_GUI_WARM` | `0` disables startup warmup |
| `NIT_GUI_PUBLIC_*` | Caddy port, host and basic-auth password |
| `NIT_GUI_DEPLOY_*` | deploy host, port and directory |

## What a public link needs

The current app is single-user and loopback-only. A public link needs work
before it is safe:

- **TLS.** Caddy should terminate HTTPS. Dictation and some browser APIs need a
  secure context; plain HTTP with basic auth is not enough for a public link.
- **Authentication.** Caddy basic auth is the only gate today. Every visitor
  shares the same OpenCode sessions, credentials and working directories. For
  more than one person, add real per-user auth and scope sessions by user, or
  keep it on a tailnet/VPN.
- **No direct exposure.** OpenCode, LanguageTool and Whisper should stay bound
  to `127.0.0.1`. Only Caddy listens publicly. Never expose the OpenCode
  password or `service.json` to the browser.
- **Host and origin checks.** Set `NIT_GUI_ALLOWED_HOSTS` for the public name.
  Keep the existing loopback `Host` and origin checks.
- **SSE.** The event stream must not be buffered or timed out by the proxy.
  Caddy works with the current `/api/events` proxy; verify long-lived
  connections and reconnect behavior.
- **Rate limits.** The Go app has no rate limiting. Put limits on `/api/prompt`,
  `/api/stt`, `/api/grammar` and uploads at the proxy, or add them to the app.
- **Uploads.** Files are written under `/tmp` on the OpenCode host and are
  never cleaned up. A public deployment needs retention and quota rules.
- **Personal dictionary.** Ignored words and learned words live in each
  browser's `localStorage`. They are not shared between users or devices. If a
  shared dictionary is wanted, store it server-side per user.
- **Data location.** LanguageTool and Whisper receive text/audio on the server.
  Say so in the privacy note; nspell stays in the browser.
- **Backups.** OpenCode owns session data. Back up its data directory and
  configuration; `/tmp` uploads are not a backup. Caddy certificates and the
  service environment file also matter.
- **Observability.** Use systemd/journald for the Go app, Caddy, LanguageTool
  and Whisper. Set restart policies and log rotation; watch disk for models,
  JRE and uploads.

## Suggested systemd shape

Use one unit per long-running process, `Restart=always`, and a shared
environment file. Example for LanguageTool:

```ini
[Unit]
Description=LanguageTool for nit-gui
After=network.target

[Service]
Environment=JAVA_TOOL_OPTIONS=-Xms256m -Xmx512m
ExecStart=/path/to/languagetool-http-server --port 8180
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
```

nit-gui then gets:

```ini
Environment=NIT_GUI_LANGUAGETOOL_URL=http://127.0.0.1:8180
ExecStart=/path/to/nit-gui --addr 127.0.0.1:7791
```

Do the same for `whisper-server` with `NIT_GUI_WHISPER_SERVER`, and for Caddy
with its own unit. OpenCode already has a service; make nit-gui `After=` and
`Wants=` it rather than starting a second copy.

## Known gaps before packaging

- `bin/languagetool` starts a detached process but has no supervisor. The
  app's internal spawn dies with the app. Systemd is the durable answer.
- `whisper-server` is not installed on the current host; only `whisper-cli` is.
  Fast dictation is unavailable until the server binary is installed.
- Accurate dictation loads the large model on every request. A second
  `whisper-server` with the large model would make it warm too, at more RAM.
- The Go app serves static files and dictionaries from its binary; there is no
  cache-busting for the fixed `/dictionaries/*` paths. Fine on loopback, worth
  checking behind a CDN.
- The public listener is plain HTTP with basic auth. TLS and a real auth layer
  are prerequisites for a public link.
- The app has no per-user accounts, quotas or session isolation.
- The TTS hub is an OpenCode plugin, not a nit-gui service; its audio client
  and latency are outside this repository.
