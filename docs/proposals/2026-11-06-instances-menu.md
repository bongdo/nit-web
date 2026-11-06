# Instances menu: make the stack legible

Date: 2026-11-06
Status: proposal, nothing implemented yet
Mockup: [`2026-11-06-instances-menu.html`](2026-11-06-instances-menu.html)

## Why this is confusing

In `nit` (TUI) an instance is easy to explain. The client runs on your machine,
so it owns the SSH tunnel, the tabs, TTS, STT and spelling. "Instance" means one
OpenCode server, and everything else is local to the client.

In nit-gui the client is split. The browser is thin, the Go service runs on a
host, and OpenCode runs somewhere else. The same capability can belong to the
browser, to nit-gui, to OpenCode, or to an optional sidecar. A menu that only
lists OpenCode servers hides that split and makes users assume the wrong owner.

The menu must answer three questions without a manual:

1. Where does nit-gui sit?
2. What is required, and what is optional?
3. For every instance, which capabilities work, and what is the fallback?

## The stack

| Layer | Owner | Runs there | Required |
| --- | --- | --- | --- |
| Browser | the device | UI, microphone capture, audio playback, device preferences, spelling worker today | yes, to use the app |
| nit-gui | a host | static bundle, `/auth`, OpenCode proxy, SSE fan-out, redaction, shared UI state, uploads, STT, grammar | yes, to use the app |
| OpenCode | a host | sessions, messages, models, agents, workspaces, tools, MCP, permissions | yes, one per instance |
| Sidecars | an OpenCode or nit-gui host | LanguageTool, `whisper-server`, `whisper-cli`, TTS hub | no |

The minimum supported stack is two processes: **OpenCode + nit-gui**. Caddy and
Tailscale Funnel are only ingress for remote access. LanguageTool, Whisper and
the TTS hub add capabilities; they never gate a chat.

## Direct answers

**Can we work with bare OpenCode?**

The nit-gui backend can: its only hard dependency is an OpenCode server and its
password. A browser cannot. Serving the static bundle without nit-gui would put
the OpenCode service password in the browser and lose `/auth`, redaction,
shared UI state, STT and grammar. That is a different product, not a thinner
client. Rejected.

**Will we require our service?**

Yes. nit-gui is the app server, not an optional companion. The browser only
talks to the same-origin `/api`; it never reaches OpenCode, LanguageTool,
Whisper or a TTS hub directly.

**Will we require running dependencies?**

No. OpenCode and nit-gui are required. Dictation, grammar, speech and server-side
spelling are optional. Each one degrades to a named fallback and the menu says
which fallback is active. A missing sidecar must never block the composer or a
chat.

## What is an instance

Recommended: **an instance is one OpenCode server behind this nit-gui**. The
nit-gui host stays fixed for the session; switching an instance changes the
OpenCode namespace: sessions, workspaces, models, agents and SSE.

The menu therefore shows two separate things:

- `This app: nit-gui @ frankfurt` — the service you are already talking to.
- `Instances` — the OpenCode servers that service can reach.

This is what makes "our app vs OpenCode vs dependencies" visible.

Rejected definitions:

- **Instance = another nit-gui deployment.** Different origin, different login,
  different UI state, no reusable SSE. If this is ever needed, call it a
  "server", not an instance.
- **Instance = OpenCode reached directly by the browser.** Exposes the service
  password, loses shared state and server-side STT/grammar, and depends on
  OpenCode CORS behavior.

## Menu

Trigger: a header chip with the active instance name and a health dot. Click it,
run `/instances`, or open Settings → Instances. Same discoverability as the TUI
status chip and `alt+i`.

List row:

```
● frankfurt     local   OpenCode 2.4.0 · 12 sessions
  dictation fast+accurate · grammar · spelling: device
```

Detail panel for the selected instance:

```
frankfurt                                  connected
local · http://127.0.0.1:49374

Browser      UI · microphone · audio · spelling (this device)
nit-gui      auth · proxy · drafts · dictation · grammar
OpenCode     sessions · models · agents · workspace · speech plugin

Capabilities
  Chat & sessions   required   OpenCode on this host
  Dictation         on         fast + accurate
  Grammar           on         LanguageTool · ~250 ms warm
  Speech            off        host TTS not connected; no device fallback
  Spelling          fallback   this browser · nspell RU+EN
```

Rules:

- Capability states are `on`, `fallback`, `off`, `unknown`. `unknown` is used
  while an instance is offline; never claim `off` for something unprobed.
- `off` always says what still works: "Dictation off — type instead",
  "Grammar off — spelling still works", "Speech off — replies stay text".
- Optional capabilities are never red. Red is reserved for a broken required
  layer (OpenCode unreachable, nit-gui error).
- An offline instance shows the reason (`ssh: connect refused`, `401`,
  `opencode service not found`) and a `Reconnect` action. Switching to it does
  not disturb the current instance.
- The footer states the contract once: "OpenCode + nit-gui are required.
  Everything else only adds capabilities."
- `Add instance` is config-first for now; the menu edits
  `~/.config/nit-gui/instances.json` on the nit-gui host, never a password in
  the browser.

## Implementation ladder

### Phase 0 — make the truth visible with one instance

No switching yet. This fixes the vocabulary and gives the menu real data.

- `GET /api/instances` in the Go backend. Shape:

```json
{
  "app": { "name": "nit-gui", "version": "dev", "host": "frankfurt" },
  "required": ["opencode", "nit-gui"],
  "instances": [
    {
      "id": "frankfurt",
      "name": "frankfurt",
      "transport": "local",
      "state": "connected",
      "opencode": { "version": "2.4.0", "url": "http://127.0.0.1:49374" },
      "sessions": 12,
      "capabilities": {
        "chat": { "state": "on", "owner": "opencode", "required": true },
        "dictation": { "state": "on", "owner": "nit-gui", "detail": "fast + accurate" },
        "grammar": { "state": "on", "owner": "nit-gui", "detail": "LanguageTool" },
        "speech": { "state": "off", "owner": "opencode", "detail": "host TTS not connected" },
        "spelling": { "state": "fallback", "owner": "browser", "detail": "nspell RU+EN" }
      }
    }
  ]
}
```

- Probes are cheap and non-spawning:
  - OpenCode: `/api/info` with a 2 s timeout.
  - Fast dictation: model file exists and the binary is on `PATH` (or the
    configured override); report the running process if there is one. Do not
    start Whisper because the menu opened.
  - Accurate dictation: `whisper-cli` plus the large model exist.
  - Grammar: probe an external URL, or check the binary/process for the spawned
    one. Never block on a cold LanguageTool start.
  - Speech: no host integration today, so `off`.
  - Spelling: the server reports the target capability; the UI merges the
    device fact (worker available or not).
- Frontend: `InstancesMenu` component, header chip, `/instances` command,
  `api.instances()`, types. No new dependency.

### Phase 1 — several URL instances

- `~/.config/nit-gui/instances.json` on the nit-gui host, parsed with
  `encoding/json` (no TOML dependency):

```json
{
  "instances": [
    { "name": "frankfurt", "url": "auto" },
    { "name": "office", "url": "http://10.0.0.5:49374", "passwordFile": "~/.config/nit-gui/office.password" }
  ]
}
```

- `internal/opencode/registry.go`: `For(id)` returns a client per instance. The
  default instance keeps today's discovery.
- Routing: the frontend sends `X-Nit-Instance: <id>` on every request. SSE uses
  `?instance=<id>` because `EventSource` cannot set headers. Missing header =
  default instance, so the single-instance path stays unchanged.
- `ui-state.json`: prefix every key with the instance id. Hidden chats,
  statuses, drafts, model and agent become per-instance. Existing keys migrate
  to the default instance on read.
- Switching closes the old SSE and opens the new one; it does not keep
  background streams for inactive instances. Refetch sessions and the selected
  transcript on switch. Store the selected workspace and chat per instance in
  `localStorage`.
- One `ConnectionStatus` for the active instance; menu rows for inactive
  instances show `unknown` until selected or a manual `Check`.

### Phase 2 — SSH transport

Reuse the TUI shape: `ssh <host> 'opencode service status'`, read the password
on the server, open a local port forward with `ssh -N -L`, then treat it as a
URL instance. Tunnel lifecycle, reconnect and backoff are separate work.

### Not doing

- Combining tabs of several instances in one strip. The GUI has a sidebar, not
  tabs; per-instance selection is enough.
- Background SSE for every instance. It multiplies connections and unread state
  for a screen that shows one chat at a time.
- Editing instances in the browser, or storing passwords there.
- A browser-only "bare OpenCode" mode.

## Current code that contradicts the target

- `web/src/components/ReplyActions.tsx` calls `speechSynthesis`, while README
  and the 2026-11-06 decision say the browser must never synthesize speech.
  Decide before the menu describes speech: remove the button, or label it
  `owner: browser`, `state: fallback`, and update the docs.
- `web/src/components/SettingsPanel.tsx` hardcodes "Private Frankfurt
  instance". It should show the app identity from `/api/instances`.
- `internal/uistate/store.go` keys state by session id only. Switching instances
  will collide until keys are instance-scoped.

## Verification

Browser scenario:

1. Open the chip. Three instances are listed; the active one is marked.
2. Select an instance whose host has no Whisper and no LanguageTool. Dictation
   and grammar show `off` with a fallback line; the composer still sends.
3. Select the offline instance. The reason and `Reconnect` are visible; the
   previous instance stays selected until a switch is confirmed.
4. Switch to a second instance, send a prompt, switch back, and confirm the
   draft and selected chat are unchanged.

`bin/check` must be green before this is called done.

## Open questions

1. Confirm the definition: one nit-gui with N OpenCode instances, or several
   nit-gui deployments? The first is recommended; the second is a later
   "servers" feature.
2. Speech: remove browser `speechSynthesis`, or keep it as an explicit device
   fallback? The menu must not imply host TTS when it is the device.
3. Phase 1 config: a JSON file on the nit-gui host is the smallest path. Is
   that acceptable, or does it wait for UI-managed instances?
