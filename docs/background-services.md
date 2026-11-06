# Background services on the Frankfurt instance

## Decision

Production runs on exactly one host: the Frankfurt instance. nit-gui,
OpenCode, Caddy, LanguageTool, Whisper and the TTS hub all live there. The
browser is a thin client: it renders the UI, records microphone audio and plays
audio. It is not assumed to have local TTS voices, local STT, Hunspell
dictionaries, LanguageTool, a GPU or any other capability.

This is a product boundary, not a temporary packaging detail. A feature that
needs a model, dictionary, voice, JVM or another process is added as a service
on Frankfurt and exposed through nit-gui. It is not pushed into the client.

The remaining client-side exceptions are listed under [Migration gaps](#migration-gaps).

## Topology

| Service | Address on Frankfurt | Role | Required |
| --- | --- | --- | --- |
| OpenCode | `127.0.0.1:49374` (varies) | Sessions, messages, models, agents, provider credentials | yes |
| nit-gui | `127.0.0.1:7791` | Go API + embedded web bundle | yes |
| Caddy | `:7792` | Public listener, basic auth, reverse proxy | for public access |
| LanguageTool | `127.0.0.1:8180` | Grammar and real-word checks | optional |
| `whisper-server` | `127.0.0.1:8178` | Fast dictation while recording | optional |
| `whisper-cli` | none | Accurate dictation, one process per request | optional |
| OpenCode TTS plugin | `127.0.0.1:7787` target; currently `0.0.0.0:7787` | Speech output; the browser never synthesizes speech | optional |
| Spelling | browser worker today, `/api/spell` on nit-gui target | RU/EN Hunspell checks | migration gap |

MCP servers, shells and PTYs belong to OpenCode. They are not managed by
nit-gui.

In the target topology only Caddy listens publicly. OpenCode, nit-gui,
LanguageTool, Whisper and the TTS hub stay on loopback; the TTS hub does not
meet that yet.

## Client contract

The browser may:

- render the UI and talk only to the same-origin `/api` endpoints;
- capture 16 kHz mono WAV from the microphone and upload it to `/api/stt`;
- play audio returned by the host;
- keep UI preferences, drafts and the personal spelling dictionary in
  `localStorage`.

The browser must not be required to:

- have a system TTS voice or call `speechSynthesis`;
- run a model, a GPU or local STT;
- carry Hunspell dictionaries or a spelling engine (target state);
- reach OpenCode, LanguageTool, Whisper or the TTS hub directly.

A browser with a microphone and audio output is enough for the product. A
feature that only works on a developer laptop because it has a local model,
voice or dictionary is not finished.

## Startup order

1. OpenCode and its TTS plugin.
2. LanguageTool and `whisper-server` (they can start in parallel).
3. nit-gui.
4. Caddy.

The Go app warms LanguageTool and fast dictation at startup. If LanguageTool is
started as a detached sidecar (`bin/languagetool`), it can start before the app
and survive app restarts. Caddy should only be exposed after the app health
check passes.

## Resource budget

| Item | Approximate |
| --- | --- |
| nit-gui process | 25–40 MB RSS |
| LanguageTool JVM | 0.6–0.7 GB RSS after RU+EN warm; 256 MB heap minimum |
| LanguageTool package + JRE | ~0.5 GB (Nix closure ~0.8 GB) |
| Fast Whisper model | 182 MB (`ggml-small-q5_1.bin`) |
| Accurate Whisper model | 548 MB (`ggml-large-v3-turbo-q5_0.bin`) |
| nspell dictionaries | ~4 MB in the web bundle while spelling stays in the browser |
| Caddy | ~20 MB |

Four cores are enough for one user. Russian grammar checks are about 250 ms,
English about 30–40 ms after warmup. Fast dictation segments are much cheaper
than the accurate one-shot pass. TTS cost depends on the plugin's provider and
is not measured here.

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

TTS is configured in the OpenCode TTS plugin, not in nit-gui. nit-gui has no
TTS environment variable and no browser speech fallback.

## Security boundary

- Production is the single Frankfurt instance. Every visitor shares the same
  OpenCode sessions, credentials and working directories. This is a one-user
  product until real per-user auth and session scoping exist.
- Caddy basic auth is the only public gate. The listener is plain HTTP; basic
  auth protects access, not the password in transit. Prefer the tailnet URL or
  put HTTPS in front (Tailscale Serve/Funnel).
- The Go listener stays on loopback. `bin/frankfurt` proxies only to
  `127.0.0.1:7791`. Set `NIT_GUI_ALLOWED_HOSTS` for the public name.
- The OpenCode password stays in the Go process and is redacted from JSON and
  SSE before it reaches the browser.
- SSE must not be buffered or timed out by the proxy. Caddy works with the
  current `/api/events` proxy; verify long-lived connections and reconnect
  behavior after proxy changes.
- The Go app has no rate limiting. Put limits on `/api/prompt`, `/api/stt`,
  `/api/grammar` and uploads at the proxy, or add them to the app.
- Uploaded files are written under `/tmp` on the OpenCode host and are never
  cleaned up. A public deployment needs retention and quota rules.
- Back up the OpenCode data directory and configuration. `/tmp` uploads are not
  a backup. Caddy certificates and the service environment file also matter.
- Use systemd/journald for the Go app, Caddy, LanguageTool and Whisper. Set
  restart policies and log rotation; watch disk for models, JRE and uploads.

## Migration gaps

- **Spelling is still client-side.** nspell and the Hunspell dictionaries run
  in a browser worker. The target is `POST /api/spell` on Frankfurt, with the
  client only rendering issues. Until then, a browser without Web Workers or
  the dictionaries gets no spelling.
- **TTS is not proxied by nit-gui.** The OpenCode TTS plugin currently listens
  on `0.0.0.0:7787` and is not part of the app. It must bind to `127.0.0.1` and
  be reached through the app or Caddy; the browser must only receive audio.
  Do not add `speechSynthesis` as a fallback.
- **No TLS.** The public listener is plain HTTP with basic auth. TLS is a
  prerequisite for a public link and for browser microphone access outside an
  SSH tunnel or tailnet HTTPS.
- **No supervisor.** `bin/frankfurt` starts the app and Caddy with `setsid`;
  they do not survive reboot. `bin/languagetool` also has no supervisor.
  systemd is the durable answer.
- **`whisper-server` is not installed on the current host.** Only
  `whisper-cli` is available, so fast dictation is unavailable until the server
  binary is installed. Accurate dictation loads the large model on every
  request; a second warm `whisper-server` with the large model would cost more
  RAM.
- **No per-user isolation.** There are no accounts, quotas or session scoping.
  A public link exposes the same sessions to every visitor.
- **No rate limits.** Add them at Caddy or in the Go app before exposing the
  instance beyond the tailnet.
- **No upload retention.** `/tmp/nit-gui-*` grows without cleanup.
- **No observability.** Use journald, restart policies and disk alerts for the
  Go app, Caddy, LanguageTool and Whisper.

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
Environment=NIT_GUI_ALLOWED_HOSTS=92.5.143.242,frankfurt
ExecStart=/path/to/nit-gui --addr 127.0.0.1:7791
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
```

Do the same for `whisper-server` with `NIT_GUI_WHISPER_SERVER`, and for Caddy
with its own unit. OpenCode already has a service; make nit-gui `After=` and
`Wants=` it rather than starting a second copy. The TTS plugin starts with
OpenCode; do not run a second TTS hub.

## Before exposing beyond the tailnet

1. Put HTTPS in front of Caddy.
2. Replace shared basic auth with real per-user authentication, or keep the
   instance on the tailnet/VPN.
3. Add rate limits for prompt, STT, grammar and uploads.
4. Add upload retention and a quota.
5. Move spelling behind `/api/spell` so the client needs no dictionaries.
6. Move the TTS hub to loopback and proxy it through nit-gui.
7. Supervise every process with systemd and verify restart on reboot.
8. Back up OpenCode data, configuration and Caddy state.
