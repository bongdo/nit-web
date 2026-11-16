# Background services on the nit-gui host

## Decision

Production runs one nit-gui service on the Frankfurt host. It fronts one or
more OpenCode servers, called instances: a local server, an explicit URL, or a
server reached through an SSH tunnel. nit-gui, Caddy, LanguageTool and the TTS
hub live on the nit-gui host. The browser is a thin client: it renders the UI and
plays audio. It is not assumed to have local TTS voices, Hunspell dictionaries,
LanguageTool, a GPU or any other capability.

Caddy terminates TLS for `bongdo.space` on `10.0.0.88:443` and forwards
everything to the gate on `127.0.0.1:8090`; the gate owns sessions, roles and the
route table. The app is exposed at `https://bongdo.space/nit/` and nowhere else.
Authentication is a server-side password page at `/auth`; there is no Caddy basic
auth and no per-user account system.

This is a product boundary, not a temporary packaging detail. A feature that
needs a model, dictionary, voice, JVM or another process is added as a service
on Frankfurt and exposed through nit-gui. It is not pushed into the client.

The remaining client-side exceptions are listed under [Migration gaps](#migration-gaps).

Shared UI state lives in `~/.local/state/nit-gui/ui-state.json`, keyed by
instance: hidden chats, done/failed markers, drafts, preferred model and agent.
The browser keeps only device preferences and an in-memory transcript cache;
drafts are mirrored to `localStorage` for instant load. That is the split that
makes hiding a chat, continuing a draft or clearing a completion marker visible
on every device.

## Topology

| Service | Address on the nit-gui host | Role | Required |
| --- | --- | --- | --- |
| OpenCode | one per instance: `127.0.0.1:49374`, URL, or a local SSH forward | Sessions, messages, models, agents, provider credentials | yes |
| nit-gui | `127.0.0.1:7791` | Go API, embedded web bundle, `/auth` login, instance registry, SSH tunnels, sessions and shared UI state | yes |
| Caddy | `10.0.0.88:443` | Let's Encrypt TLS, forwards everything to the gate | yes |
| gate | `127.0.0.1:8090` | Sessions, roles, route table; proxies `/nit`, `/pero`, `/term`, `/share` | yes |
| LanguageTool | `127.0.0.1:8180` | Grammar and real-word checks | optional |
| OpenCode TTS plugin | `127.0.0.1:7787` target; currently `0.0.0.0:7787` | Speech text hub for an audio client; nit-gui publishes to it | optional |
| `piper` | nit-gui host | Warm host voice worker; browser voice is the last fallback | optional |
| Spelling | browser worker today, `/api/spell` on nit-gui target | RU/EN Hunspell checks | migration gap |

MCP servers, shells and PTYs belong to OpenCode. They are not managed by
nit-gui.

## Instances

`instances.json` (`NIT_GUI_INSTANCES`, or
`${XDG_CONFIG_HOME:-$HOME/.config}/nit-gui/instances.json`) defines named
OpenCode servers:

```json
{
  "instances": [
    { "name": "frankfurt", "url": "auto" },
    { "name": "riga", "ssh": "riga-dev", "dir": "/home/bongdo/Projects" },
    { "name": "office", "url": "http://10.0.0.5:49374", "passwordFile": "~/.config/nit-gui/office.password" }
  ]
}
```

- Missing or empty means one auto-discovered instance named `local`.
- `url: "auto"` uses `NIT_SERVER` / `OPENCODE_SERVER` / `OPENCODE_URL`, then
  `opencode service status`.
- An explicit remote `url` needs `passwordFile` or inline `password`.
- `ssh` runs `opencode service status` and reads `service.json` on the remote
  host, then opens a local port forward with the `ssh` binary. The tunnel lives
  until `DropFor` or app shutdown.
- The first instance is the default. Names match `^[A-Za-z0-9._-]{1,64}$`.
- Passwords stay on the nit-gui host. A config with an inline password should be
  mode `0600`; the app warns otherwise. A malformed file falls back to `local`
  and the error is shown in the Instances menu.
- The Instances menu creates, edits and deletes entries. Saving writes the file
  atomically with mode `0600` and reloads the registry in place. A password
  typed in the form is written to a separate `0600` file next to the config; it
  is never returned to the browser. Renaming moves the saved drafts, hidden
  chats and done/failed markers. Deleting keeps that state in `ui-state.json`,
  so recreating the same name re-attaches it.

The browser sends `X-Nit-Instance: <id>` on every API request and `?instance=`
on `EventSource` and `/api/file` links. Only the active instance keeps an event
stream; switching remounts the chat view and reloads that instance's sessions,
models, agents and drafts. Grammar and host TTS run on the nit-gui
host and are therefore shared by all instances; sessions, models, agents and
workspaces are per instance.

Only the domain is public. Caddy owns `10.0.0.88:443` and forwards to the gate;
OpenCode, nit-gui, LanguageTool and the TTS hub stay on loopback (the TTS hub does
not meet that yet). The old tailscale funnel entry was removed.

## Client contract

The browser may:

- render the UI and talk only to the same-origin `/api` endpoints;
- play audio returned by the host;
- keep UI preferences and the personal spelling dictionary in `localStorage`;
- mirror drafts to `localStorage` for instant load, but treat `/api/ui` as the
  source of truth;
- read hidden, done/failed, drafts, model and agent state from `/api/ui`;
- hold the session in an HttpOnly cookie; the password is never stored in the
  browser;
- ask `/api/tts` to publish reply text to the host TTS hub; the hub token never
  reaches the browser;
- use `speechSynthesis` only as a labeled device fallback when the hub has no
  audio client or is down. It is never presented as host speech.

The browser must not be required to:

- have a host TTS voice; a browser without a local voice simply gets no speech;
- run a model, a GPU or local STT. Dictation is the client device's job: the
  composer is a plain textarea and the OS or browser dictation types into it;
- carry Hunspell dictionaries or a spelling engine (target state);
- reach OpenCode, LanguageTool or the TTS hub directly.

A browser with audio output is enough for the product. A
feature that only works on a developer laptop because it has a local model,
voice or dictionary is not finished; the Instances menu must say which fallback
is in use.

## Startup order

1. OpenCode and its TTS plugin.
2. LanguageTool.
3. nit-gui.
4. the gate on `127.0.0.1:8090`.
5. Caddy on `10.0.0.88:443` (`bin/deploy`).

The Go app warms LanguageTool at startup. A local or URL
instance is contacted on demand; an SSH tunnel opens on the first request that
needs that instance. If LanguageTool is started as a detached sidecar
(`bin/languagetool`), it can start before the app and survive app restarts.
Reload the gate and Caddy only after the app health check passes.

## Resource budget

| Item | Approximate |
| --- | --- |
| nit-gui process | 25–40 MB RSS |
| LanguageTool JVM | 0.6–0.7 GB RSS after RU+EN warm; 256 MB heap minimum |
| LanguageTool package + JRE | ~0.5 GB (Nix closure ~0.8 GB) |
| nspell dictionaries | ~4 MB in the web bundle while spelling stays in the browser |
| Caddy | ~20 MB |

Four cores are enough for one user. Russian grammar checks are about 250 ms,
English about 30–40 ms after warmup. TTS cost depends on the plugin's provider
and is not measured here.

## Configuration

| Variable | Used by |
| --- | --- |
| `NIT_SERVER`, `OPENCODE_SERVER`, `OPENCODE_URL` | nit-gui discovery |
| `XDG_CONFIG_HOME` | OpenCode `service.json` password |
| `NIT_GUI_INSTANCES` | path to `instances.json`, default `$XDG_CONFIG_HOME/nit-gui/instances.json` |
| `NIT_GUI_ALLOWED_HOSTS` | extra `Host` names behind a reverse proxy |
| `NIT_GUI_LANGUAGETOOL` | path to `languagetool-http-server`; app spawns it |
| `NIT_GUI_LANGUAGETOOL_URL` | use an already running LanguageTool |
| `NIT_GUI_LANGUAGETOOL_PORT` | spawned LanguageTool port, default `8179` |
| `NIT_GUI_LANGUAGETOOL_JAVA_OPTS` | JVM options, default `-Xms256m -Xmx512m` |
| `NIT_GUI_TTS_URL` | OpenCode TTS hub, default `http://127.0.0.1:7787` |
| `NIT_GUI_TTS_TOKEN_FILE` | hub token file, default `$XDG_STATE_HOME/opencode-tts/token` |
| `NIT_GUI_TTS_TOKEN` | direct hub token, overrides the file |
| `NIT_GUI_TTS` | `off` disables host TTS |
| `NIT_GUI_TTS_ENGINE` | host voice: `auto`, `piper`, `off` |
| `NIT_GUI_TTS_PIPER` / `_PIPER_MODEL` | piper binary and voice model |
| `NIT_GUI_TTS_RATE` | speech rate, default `1.0` |
| `NIT_GUI_WARM` | `0` disables startup warmup |
| `NIT_GUI_PUBLIC_HOST` | Label and allowed host, default `frankfurt.tailf358cb.ts.net` |
| `NIT_GUI_DOMAIN` | Domain served on 443, default `bongdo.space`; empty aborts the deploy |
| `NIT_GUI_BASE_PATH` | External path prefix, default `/nit` |
| `NIT_GUI_AUTH_ENV` | Auth env file, default `~/.config/nit-gui/auth.env` |
| `NIT_GATE_PASSWORD_HASH` | Shared PBKDF2-SHA256 login hash set by `bin/auth` |
| `NIT_GATE_PASSWORD` | Plain local-development password, hashed at startup |
| `NIT_GUI_STATE` | Shared UI state path, default `~/.local/state/nit-gui/ui-state.json` |
| `NIT_DROP_ROOT` | Drop store, default `~/.local/share/nit-gui/drop` |
| `NIT_DROP_MAX_UPLOAD` | Browser upload limit in bytes, default 128 MiB |
| `NIT_GUI_DEPLOY_*` | deploy host, port and directory |

TTS has three host paths. nit-gui keeps a warm `piper` worker (`--json-input`)
and streams its PCM through `POST /api/tts/stream` while the browser schedules
it with Web Audio; the reply is split into paragraphs and sentences and
Markdown is rewritten for speech (code blocks, paths, URLs, tables). With no
warm worker it synthesizes the whole reply with piper (`NIT_GUI_TTS_ENGINE`,
`_PIPER_MODEL`) and returns WAV to the browser. If the host has no voice it
publishes to the OpenCode TTS hub (`NIT_GUI_TTS_URL`/`NIT_GUI_TTS_TOKEN_FILE`,
or `NIT_GUI_TTS_TOKEN`) when an audio client is connected. The browser's
`speechSynthesis` is the last fallback.

## Security boundary

- Production is one nit-gui service on Frankfurt. Every visitor shares the same
  set of OpenCode instances, sessions, credentials and working directories. An
  instance is a separate OpenCode namespace, not a security or quota boundary.
  This is a one-user product until real per-user auth and session scoping exist.
- Caddy terminates public TLS on `10.0.0.88:443` and proxies only to the gate
  on `127.0.0.1:8090`, which routes to the app on `127.0.0.1:7791`. Set
  `NIT_GUI_ALLOWED_HOSTS` for the public name.
- The app login is a server-side password page at `/auth`. The password is
  stored as a PBKDF2-SHA256 hash (600k rounds), the signed `nit_gate` cookie is
  HttpOnly, Secure, SameSite=Lax and shared with pero-gui and term-gui for
  7 days, and the login page sends no-store plus a strict CSP. Five wrong
  passwords block the source IP for 15 minutes; 50 failures across all clients
  block new logins for 5 minutes.
- Instance editing is authenticated and writes only on the host. A typed
  password goes to a separate `0600` file; the API never returns it. The TTS hub
  token is read by the Go process and never sent to the browser. The login form and
  authenticated requests accept `Origin: null` from privacy browsers;
  unauthenticated API requests do not.
- The OpenCode password stays in the Go process and is redacted from JSON and
  SSE before it reaches the browser. The login password is never logged or put
  in a URL.
- SSE must not be buffered or timed out by the proxy. Caddy works with the
  current `/api/events` proxy; verify long-lived connections and reconnect
  behavior after proxy changes.
- API rate limiting is still missing. Put limits on `/api/prompt`,
  `/api/grammar` and uploads at the proxy, or add them to the app.
- Uploaded files are written under `/tmp` on the OpenCode host and are never
  cleaned up. A public deployment needs retention and quota rules.
- `ui-state.json` contains draft text and must stay mode `0600`. Back up the
  OpenCode data directory and configuration; `/tmp` uploads are not a backup.
  `auth.env`, `ui-state.json`, the Caddy config and Tailscale state also matter.
- Use systemd/journald for the Go app, Caddy and LanguageTool. Set
  restart policies and log rotation; watch disk for models, JRE and uploads.

## Migration gaps

- **Spelling is still client-side.** nspell and the Hunspell dictionaries run
  in a browser worker. The target is `POST /api/spell` on Frankfurt, with the
  client only rendering issues. Until then, a browser without Web Workers or
  the dictionaries gets no spelling.
- **Host voice keeps one piper worker.** The worker starts during server
  warmup, holds the ~63 MB model in memory and serializes segments; the first
  audio arrives in about a second and later segments in about half a second.
  The hub still listens on `0.0.0.0:7787`; only the token protects it. Bind it
  to `127.0.0.1` when the host is exposed beyond the tailnet.
- **Instance editing writes on the host.** The menu writes `instances.json` and
  password files with mode `0600`; a custom `NIT_GUI_INSTANCES` path must be
  writable by the app user. External edits are read on reload/restart.
- **SSH tunnels are not reconnected automatically.** A tunnel lives until
  `DropFor` or app shutdown. Use `Reconnect` or switch to the instance again
  after a network drop. There is no background health check for inactive
  instances.
- **Only the active instance has an event stream.** Inactive instances do not
  accumulate unread counts or approvals; switching reloads the list and
  transcript.
- **UI state has no push channel.** Clients read it on focus and every 10
  seconds. The JSON file is last-write-wins, drafts are capped at 256 KiB, and
  a completion marker only exists if a client was open to receive the idle
  event.
- **One shared password, in-memory sessions.** There is no per-user account,
  2FA or session revocation list. An app restart signs everyone out and clears
  login lockout counters.
- **One ingress.** `bongdo.space` on `92.5.143.242:443` is the only public
  entry; the ephemeral public IP is not reserved, so DNS must follow it.
- **No supervisor.** `bin/deploy` starts the app and Caddy with `setsid`;
  they do not survive reboot. `bin/languagetool` also has no supervisor.
  systemd is the durable answer.
- **Dictation is client-side by design.** nit-gui has no STT endpoint or model.
  The composer is a plain textarea, so the device's own dictation works. Better
  STT can return later as an optional server capability.
- **No per-user isolation.** There are no accounts, quotas or session scoping.
  A public link exposes the same sessions to every visitor.
- **No API rate limits.** Login has lockout, but prompt, grammar and
  uploads do not. Add limits at Caddy or in the Go app before exposing the
  instance beyond the tailnet.
- **No upload retention.** `/tmp/nit-gui-*` grows without cleanup.
- **No observability.** Use journald, restart policies and disk alerts for the
  Go app, Caddy and LanguageTool.

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
[Unit]
Description=nit-gui
After=network.target

[Service]
Environment=NIT_GUI_LANGUAGETOOL_URL=http://127.0.0.1:8180
Environment=NIT_GUI_ALLOWED_HOSTS=bongdo.space,www.bongdo.space,frankfurt
Environment=NIT_GUI_PUBLIC_HOST=frankfurt
Environment=NIT_GUI_BASE_PATH=/nit
EnvironmentFile=%h/.config/nit-gui/auth.env
ExecStart=/path/to/nit-gui --addr 127.0.0.1:7791
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
```

Do the same for Caddy with its own unit. OpenCode already has a service; make
nit-gui `After=` and `Wants=` it rather than starting a second copy. The TTS
plugin starts with OpenCode; do not run a second TTS hub.

## Before exposing beyond the tailnet

1. Keep TLS at Caddy on 443; the gate and the app stay on loopback.
2. Replace the shared password with real per-user authentication if more than
   one person needs access.
3. Add rate limits for prompt, grammar and uploads.
4. Add upload retention and a quota.
5. Move spelling behind `/api/spell` so the client needs no dictionaries.
6. Move the TTS hub to loopback and proxy it through nit-gui.
7. Supervise every process with systemd and verify restart on reboot.
8. Back up OpenCode data, configuration, `auth.env` and Caddy state.
