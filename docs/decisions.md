# Decisions

## 2026-11-16 — A machine's home is mounted at the same absolute path

Context: a chat on a machine carries paths like `/home/bongdo/Projects/x`, and the
home term/pero chips opened those paths on frankfurt, where they did not exist.

Decision: mount each machine's home at its own absolute path —
`sshfs <host>:$HOME $HOME -o idmap=user,follow_symlinks,reconnect` — through the
systemd user unit that `bin/mount-home <host>` writes. The mount point is created
once, as root, on the machine that mounts. Nothing maps paths anywhere: chats,
file links, terminals and a later home opencode all use the same string.

Why: with identical paths there is no translation layer to keep in sync between
the file tools, the shell and the browser links.

Rejected: a different mount root with path rewriting (a mapping in every link and
every tool call); NFSv4 now (a second listening service on each machine; the
options line is swappable if sshfs latency hurts).

Cost: sshfs costs a round-trip per metadata call, and a machine that is down makes
its home return EIO instead of an empty directory; the mount point needs root once
per machine.

## 2026-11-16 — The bridge is deleted; the gate is a door to home apps

Context: the reverse-tunnel rule made a machine an ssh target, but the bridge was
still running on each machine and the gate still carried its protocol, machine
registry, tokens, framing proxy and terminal plan.

Decision: delete `cmd/bridge`, `bin/bridge`, `internal/gate/agent*.go`,
`agents.go`, the `/agent`, `/api/agents` and `/i/<machine>/...` routes, the
`gate token` command and the gate WebSocket code. The gate keeps users, roles,
routes and `/nit`, `/pero`, `/term`, `/share`. A machine that runs an opencode
server is reached by nit-gui's `ssh` instance transport (`ssh <host>` discovers the
service, reads its password, forwards a port), not through the gate.

Why: ssh already does shell, files and forwarding; every capability the bridge
grew was a second implementation with its own protocol, updater and token store.

Rejected: keeping the bridge for machines without ssh (nothing here needs it);
proxying another machine's pero/term through `/i/` (home apps take a URL, a
machine takes ssh).

Cost: `NIT_GUI_PERO_URL`/`NIT_GUI_TERM_URL` are the only per-machine app links
left, so a machine's own editor and terminal are not reachable through the gate.
`~/.config/nit-gui/agents.json` is now dead state. This replaces 2026-11-15
"The bridge is the gate's agent" and "The terminal lives inside the bridge".

## 2026-11-16 — A machine is an ssh target; the route is a reverse tunnel

Context: the bridge is the only thing installed on a machine, but it re-implements
shell, files and port access, and every capability grows our protocol, our updater
and our token store.

Decision: a machine is reachable when frankfurt can open ssh to it. The default
route is a per-machine reverse tunnel — `ssh -R 127.0.0.1:<port>:localhost:22`,
a systemd user unit, a key restricted with `permitlisten` — from the machine to
`bongdo.space`. LAN, tailnet and a public address are equivalent alternatives;
nothing of ours runs on the machine. nixos is the first machine on this route:
port 2222, `Host nixos` points at `127.0.0.1:2222`.

Why: sshd already exists on every machine and does shell, files and forwarding
better than a bespoke protocol, so the dependency on the machine drops from our
binary, unit, token and update path to a service the OS already runs.

Rejected: the bridge as the general mechanism (own protocol, version matrix,
updater and token store for what ssh does; this replaces 2026-11-15 "The bridge
is the gate's agent" as the way to reach a machine); tailscale as the only route
(another daemon and a controller, needed only because these two machines sit on
different networks).

Cost: the house sshd is exposed to the internet and is already being scanned, so
key-only auth and bans are mandatory; the tunnel cannot be repaired over itself;
a machine nothing can ssh to is out of scope. The bridge stays running until
opencode-at-home workspaces replace the per-machine opencode instance.

## 2026-11-15 — Switchless instances: owner-aware actions, one network toggle

Context: the bridge already routes every request to any machine (`/i/<name>/...`), but the GUI kept one active instance and either switched the whole app or refused cross-machine actions.

Decision: hide/delete/unhide act on the chat's own instance without switching; `Everywhere` directory headers create chats in that directory on that machine; the workspace picker has machine chips, recent-first and a separate browse mode; `showHidden` is one value for the network; term/pero are always shown, using `/i/<name>/pero/` and `/i/<name>/term/` for bridge instances.

Why: the switch was a client-side mode, not a connection. The server already takes the owner on every request, so refusing or remounting was unnecessary.

Rejected: a global Switch button with per-instance UI state; hiding term/pero for non-local transports; per-instance `showHidden`.

Cost: opening a chat on another machine still focuses that machine (the App is keyed by instance for now); removing that remount needs selection to become `(instance, id)` everywhere.

## 2026-11-15 — One event stream per machine, not one per app

Context: `Everywhere` showed chats from every machine but only the focused machine had live events, polling and UI status. A chat on another machine looked frozen until it was opened.

Decision: open one SSE stream per machine that has a chat in the current list; tag every event with its machine; keep done/failed status per machine and merge the sets for the sidebar. Transcripts are cached by `instance|id`, and the opened chat is seeded into the boot cache before the focus changes. Foreign structural events refetch only that machine; focus events reuse cached foreign lists.

Why: the bridge is per-request, so multiple streams cost nothing extra and the list stops being a snapshot.

Rejected: polling all machines on a timer; one multiplexed SSE endpoint in Go (more server surface for the same result).

Cost: one reconnect loop per machine with chats; foreign forms/permissions are fetched on their events rather than polled; status ids are still assumed unique across machines.

## 2026-11-04 — Keep untrusted HTML out of the app DOM

Context: transcripts contain model-produced markdown and sometimes complete HTML documents. The GUI must render both without giving model output access to the app.

Decision: render markdown with `react-markdown` and `remark-gfm` only, with no raw-HTML rehype plugin. Detect HTML-looking text and fenced `html` blocks, and render them in `iframe srcdoc` with `sandbox="allow-scripts allow-forms allow-modals"` and no `allow-same-origin`.

Why: the sandbox gives previews an opaque origin, so scripts cannot read the parent DOM, cookies or local storage. The rest of the app never receives raw HTML as DOM.

Rejected: `rehype-raw` plus an HTML sanitizer (larger attack surface, easy to misconfigure); a separate preview origin/server (more moving parts than the brief needs).

Cost: inline HTML inside a markdown answer is shown as preview/source rather than inline; the preview is a fixed-height iframe.

## 2026-11-04 — Proxy SSE instead of adding a second protocol

Context: the browser needs live text, reasoning, tool and idle events from OpenCode. The service already exposes `GET /api/event` as SSE.

Decision: the Go backend proxies raw SSE from OpenCode to `GET /api/events`; the frontend uses the native `EventSource` API and reduces events into the current transcript. The backend reconnects nothing; the browser reconnects, and the app refetches sessions and the selected transcript after a reconnect.

Why: no WebSocket dependency, no protocol translation, and the service remains the source of truth. The browser gets disconnect and retry behavior from `EventSource`.

Rejected: decoding events in Go and inventing a second event schema; polling messages on a timer.

Cost: events are not replayed after a gap, so the client must treat refetch as authoritative. Users on a stale event stream may wait for the next idle/refetch to see a completed message.

## 2026-11-04 — Local shadcn primitives, no Radix dependency

Context: the brief asks for shadcn/ui primitives and a small dependency list. Only buttons, inputs, a textarea, badges and two pickers are needed.

Decision: keep the shadcn-style source for `Button`, `Input`, `Textarea`, `Badge` and a styled native `Select` in `web/src/components/ui`. Icons come from `lucide-react`.

Why: the primitives are small, accessible enough for this screen, and avoid pulling a full component library or Radix packages for two selects.

Rejected: `shadcn add` with Radix Select and DropdownMenu; a general-purpose UI framework.

Cost: no virtualized select, no portal positioning, and the picker is a native select with the platform's menu behavior.

## 2026-11-04 — Redact service credentials at the proxy boundary

Context: a transcript can contain the OpenCode service password because a tool can read `service.json`. Forwarding upstream JSON or SSE unchanged puts that password in the browser DOM.

Decision: the Go client builds a redactor from the current password. Every pass-through JSON body and every SSE `data` payload is decoded, string values are replaced (`password`, `opencode:<password>`, the base64 Basic auth value), and JSON is re-encoded. SSE is buffered to whole lines before redaction. App-built summaries (models, agents, config) are unchanged.

Why: value-level redaction keeps JSON valid even when the password needs JSON escaping; line buffering prevents a password split across TCP chunks from escaping.

Rejected: byte replacement on the whole body (breaks JSON escaping and chunked SSE); browser-side redaction (the secret would already have left the Go process).

Cost: a transcript page is decoded and re-encoded once; upstream error text is redacted the same way.

## 2026-11-05 — Chat shortcuts: Alt+N, Alt+J/K, quote selection

Context: new chats were bound to mod+n, but browsers reserve Ctrl/Cmd+N, so the binding never reached the page. The chat list had no keyboard cycling, and quoting a reply meant copying text by hand.

Decision: new chat on Alt+N, next/previous chat on Alt+J/K in the sidebar order, and a Quote button that appears on text selected in the transcript and inserts a markdown quote into the composer.

Why: Alt+N works in every browser and `event.code` keeps both bindings independent of the keyboard layout. Alt+J/K follows the vim-like next/previous convention and avoids Option+Arrow, which moves the cursor by word in the composer on macOS.

Rejected: Tab for cycling chats (breaks keyboard focus navigation), Ctrl+Tab (reserved by the browser) and Alt+Arrow (conflicts with word navigation).

Cost: three app-wide shortcuts; Alt+J/K is only discoverable from /help, the New chat hint and the README.

## 2026-11-05 — Composer spelling: local nspell + Hunspell, no model

Context: the composer needs Russian and English correction. A model-backed proofreader and ghost completion were proposed and OpenCode's stateless generate endpoint was tested; the user requires correction without AI.

Decision: ship offline spellchecking with `nspell` and the `dictionary-ru` / `dictionary-en` Hunspell dictionaries. The dictionaries are served as assets and parsed in a worker. No model, no cloud call, no LanguageTool sidecar. Ghost completion is not part of this change.

Why: the dictionaries are about 4 MB, need no runtime or account, and keep the draft in the browser. LanguageTool would add Java and about 1.5 GB for grammar support that was not requested.

Rejected: OpenCode generate (sends the draft to a provider), LanguageTool (heavy), Harper (English only), Chrome Proofreader (trial, English-oriented), Yandex Speller (cloud), a local LLM (extra runtime and model).

Cost: spelling only. Real-word errors (`too` vs `to`), Russian `-тся/-ться` and punctuation are not caught. The first check waits for a worker-side dictionary parse of a few seconds.

## 2026-11-06 — Deploy targets: nixos and frankfurt through Caddy

Context: the app needs one-command deploys to the NixOS host and to the Frankfurt box, but the Go listener is loopback-only and has no authentication of its own.

Decision: `bin/deploy [nixos|frankfurt]` with `bin/nixos` and `bin/frankfurt` aliases. NixOS keeps the existing cross-compile-and-restart path. Frankfurt builds locally, restarts on `127.0.0.1:7791`, and starts a user Caddy on `:7792` with basic auth and the existing Caddy password hash. The app trusts extra `Host` names from `NIT_GUI_ALLOWED_HOSTS`; the proxy forwards the original Host and Origin, so the CSRF check stays intact.

Why: no root or system-Caddy edit is needed, the public listener never exposes the Go app directly, and the existing Caddy password is reused. The app remains loopback-only.

Rejected: binding the Go server to `0.0.0.0` (no auth), adding app-level basic auth (duplicates Caddy), and editing `/etc/caddy/Caddyfile` (needs root).

Cost: a second Caddy process that does not survive reboot; plain HTTP without a secure context, so remote dictation needs an SSH tunnel or HTTPS; the public port must be opened in the OCI security list.


## 2026-11-06 — Hybrid spelling and grammar

Context: nspell catches typos in the browser instantly. LanguageTool catches real-word errors (`too`/`to`) and some punctuation, but the measured Russian check is about 250 ms and the process needs about 0.7 GB RSS.

Decision: keep nspell for spelling and add an optional LanguageTool sidecar for grammar. The backend starts `languagetool-http-server` lazily or uses `NIT_GUI_LANGUAGETOOL_URL`; spelling and capitalization rules are disabled, the browser waits 700 ms before asking, and nspell wins when the two overlap. Without a sidecar the composer still checks spelling.

Why: this keeps instant feedback for typos and adds the errors nspell cannot see, without a cloud service or an AI model.

Rejected: LanguageTool only (slower Russian checks, loses instant feedback), nspell only (misses `too`/`to` and punctuation), an AI proofreader.

Cost: about 0.7 GB RSS on the host running LanguageTool, a 3–4 s warm-up on the first grammar request, ~250 ms per Russian check, and a Java dependency. Grammar stays optional.

## 2026-11-06 — Warm grammar and dictation at startup

Context: LanguageTool took 4–6 s on the first grammar request, and the fast dictation server started only when the microphone was first used. The user wants the shortest possible wait.

Decision: the Go server starts LanguageTool and `whisper-server` in background goroutines at startup. LanguageTool can also run as a detached sidecar through `bin/languagetool`; the app then uses `NIT_GUI_LANGUAGETOOL_URL` and survives app restarts. Fast dictation uses `NIT_GUI_WHISPER_SERVER` and the small model.

Why: the user pays the warmup once when the app starts, not on every first action. A detached sidecar also removes the cold start across deploys.

Rejected: starting LanguageTool lazily (the old 5–10 s first check), starting it synchronously before serving (the app would take seconds to open), keeping fast dictation lazy.

Cost: LanguageTool uses about 0.6–0.7 GB and fast dictation loads its model at boot; if the binaries or models are missing, warmup is skipped and the feature falls back silently. The external sidecar has no supervisor unless it is run under systemd.

## 2026-11-06 — Safe auto-fix with word-level undo

Context: most underlined words are typos, but nspell often returns several equally close suggestions (`хочю` → `холю`, `хорю`, `хочу`). Auto-applying the first suggestion would damage names and terms.

Decision: auto-fix only lowercase words of four or more characters that are not code, paths, commands or ignored, and only when exactly one suggestion is one Levenshtein edit away. The fix runs after a space, keeps the rest of the text, and shows a `↶ word` chip for ten seconds. Clicking it or `Ctrl/Cmd+Z` restores just that word and adds the original to the ignore list. Settings → Auto-fix typos can disable it.

Why: it removes the obvious, unambiguous typos while leaving ambiguous ones on the existing suggestion chip. Word-level undo is faster than retyping and does not discard later edits.

Rejected: auto-applying the first nspell suggestion (too many false positives), auto-fixing capitalized words and names, a whole-text undo (would throw away typing after the fix).

Cost: conservative coverage; `хочю` and many English typos with two close candidates still need a click. The undo entry expires after ten seconds.

## 2026-11-06 — Attachments: upload once, let OpenCode read

Context: the composer accepted any file but a prompt required text, PDFs were only links, and model input capabilities were not visible. OpenCode already sniffs uploaded files and forwards plain text, images and PDFs to the model; other MIME types reach the model as nothing.

Decision: upload files to a sanitized `/tmp/nit-gui-*` name, cap uploads at OpenCode's 20 MiB, allow a prompt with files and no text, expose `capabilities.input` from `/api/models`, warn when the selected model cannot read an image or PDF, and render images/PDFs/other files in the transcript. `/api/file` only serves the upload prefix and cleans `..` before the prefix check.

Why: the GUI should not duplicate OpenCode's MIME handling or convert documents in the browser. A warning is honest about model limits; text extraction or PDF rendering would add a runtime dependency.

Rejected: converting PDFs to text locally, blocking every file the model cannot read, serving arbitrary file paths through `/api/file`.

Cost: other binary files are uploaded but not sent to the model; PDFs need a PDF-capable model; the PDF preview depends on the browser's built-in viewer and a `SAMEORIGIN` frame header on `/api/file`.

## 2026-11-06 — Per-chat composer drafts

Context: the composer kept one textarea value for the whole app. Typing in one chat and switching to another left the text in place, and reloading lost it. Unsent attachments also leaked between chats.

Decision: key the composer by the selected session (or by workspace for a new chat), initialize its text from `localStorage`, and persist every edit under `nit-gui.draft.<key>`. Sending clears that key. Remounting on a chat switch also resets attachments, form state, dictation and undo state. The external revert/quote effects are consumed once and cleared so they do not replay on the next chat.

Why: remounting is the smallest change that gives each chat independent transient state and makes the draft survive reloads. A lifted draft map only in React state would still lose drafts on reload.

Rejected: one global draft (leaks between chats), lifting every composer field into App state (large rewrite for no extra behavior), persisting attachments (needs a serialized upload queue; not requested).

Cost: unsent attachments are dropped on a switch, drafts are stored in plain text in `localStorage`, and empty entries are removed only when the input is cleared or sent.

## 2026-11-06 — Subagent sessions stay out of the sidebar

Context: the `All` scope fetched children and rendered agent-spawned subagent sessions as top-level chats. A subagent chat the user never created could appear in the list. The selected subagent also has to survive a reload so the header can show `Back to parent`.

Decision: the sidebar lists top-level sessions only in every scope. The scopes now mean: this workspace, the user's primary-agent chats across workspaces, and every top-level chat including scripted roles. Subagents are opened from the parent header's `N subagents` menu. `GET /api/sessions/{id}` restores a selected session that is not in the top-level page.

Why: agent-created child sessions are internal work, not user chats; the parent header is the only place that gives them context. Keeping the selected child in state, but not in the list, preserves navigation without polluting the sidebar.

Rejected: keeping subagents in `All` as a debug view (they looked like user chats), hiding only on the client after grouping (the 100-session page would still fill with subagents).

Cost: subagent sessions are only reachable through their parent; a reload of a subagent URL restores it via an extra upstream request, and the parent must still be in the top-level page for `Back to parent`.

## 2026-11-06 — Instant chat switching: transcript cache and raw pass-through

Context: opening a large chat took about a second. The proxy re-encoded every message, Go asked OpenCode for gzip (whose compression cost more than the transfer), and the UI refetched the whole transcript on every switch.

Decision: keep the last five normalized transcripts in memory, update them from the SSE stream, and restore them before any fetch; fetch only on first open, explicit reload and reconnect. The proxy requests identity encoding for transcripts, passes clean `data` pages through without decoding each message, and writes one response body. Streaming rows, the sidebar, header and composer are memoized, and delta events are coalesced per animation frame.

Why: switching back to a cached chat is immediate; the first open of the heaviest local transcript dropped from about 1.05s to 0.31s. Redaction still runs on every page and SSE payload; the fast path only skips bodies that cannot contain a secret.

Rejected: persisting transcripts in localStorage (5 MB limit and huge payloads), IndexedDB (more moving parts for the same result), virtualizing the transcript (a separate feature), and disabling upstream compression globally (other endpoints can still benefit).

Cost: the cache is lost on reload and trusts the event stream for background updates; a change made by another client to a cached, non-running session is not seen until reconnect or reload.

## 2026-11-06 — Long chats: tail-first light transcripts and a size-bounded cache

Context: even after the proxy fixes, a 17 MB transcript took about a second to open. Almost all of it was tool output (14.8 MB) and reasoning (0.5 MB); the user rarely opens those and mostly needs the final answer, their own messages, questions and compaction.

Decision: the client opens the newest 50 messages with `?light=1&limit=50`. Light mode removes tool `state.content`, truncates reasoning to 240 characters and large tool input to 2 KB, and marks those parts `light`. Opening a tool or thought fetches one full message from `GET /api/sessions/{id}/messages/{messageID}`. Older pages load on demand with the cursor from the tail. The in-memory cache stores light transcripts under a 12 MiB budget (at most 30 entries) instead of a fixed five.

Why: the heaviest local chat now opens with about 110 KB and 0.13 s instead of 15.9 MB and 1.05 s; a single tool message loads in about 5 ms. Light entries are small, so the budget holds many more chats than a fixed count.

Rejected: virtualizing the whole transcript (more UI work), loading the full history in the background (wastes the transfer we just avoided), persisting transcripts in IndexedDB (a separate feature), and dropping tool calls entirely (they still give the activity summary and can be opened).

Cost: long chats open at the tail; older messages need "Load earlier". Full tool output and reasoning are one request away, and the cache evicts the least recently used chats by total size.

## 2026-11-06 — Earlier pages load automatically

Context: the manual "Load earlier messages" control from the previous entry is not how a chat should behave; the next page must be there before the user reaches the top.

Decision: `ChatView` requests the previous page when the scroll position is within 400 px of the top, and also fills the viewport when the whole transcript is shorter than the viewport plus that margin. A small "Loading earlier…" pill replaces the button. After prepending, the scroll position is adjusted by the added height so the visible messages do not jump.

Why: the prefetch hides the network latency behind the user's own scrolling, and the scroll anchor keeps the reading position stable.

Rejected: keeping the button as a fallback (it breaks the flow), loading the entire history at once (wasteful), and relying on browser scroll anchoring (the transcript disables it for streaming).

Cost: one extra page request when the user approaches the top; a short transcript may auto-load a few pages until it fills the viewport.

## 2026-11-06 — Steps load only when the user opens them

Context: the light transcript still carried tool input, metadata and a reasoning preview, so the steps block showed targets without being opened and still paid for data the user rarely looks at.

Decision: light mode keeps only the fact of a step: tool id, name, status, time and error, plus an empty reasoning stub. Tool input/output/metadata and reasoning text are removed. Opening the steps block fetches the full messages for that turn in parallel; opening an individual tool or thought remains a per-row fallback. User messages, assistant text parts, forms/questions and compaction summaries stay full.

Why: the steps block is closed by default, so its data should cost nothing until opened. The heaviest local tail dropped to about 74 KB, while every user message and final answer is guaranteed to be present.

Rejected: keeping input previews (contradicts the request), loading the full transcript on panel open (wasteful), and per-row-only loading (the opened steps list would show bare verbs without targets).

Cost: opening steps triggers one request per assistant message in the turn; a failed row can be retried by opening it.

## 2026-11-06 — Questions are transcript input, not steps

Context: the `question` tool was stripped like any other step, so answered questions disappeared from the transcript and pending questions existed only in the composer form.

Decision: `question` tool parts pass through light mode unchanged, including input, answer content and metadata. A `QuestionCard` renders them outside the collapsed steps panel with the question, options, the chosen answer and a waiting state. Pending questions still use the composer form.

Why: a question is the user's input, so it belongs with user messages and final answers rather than behind steps.

Rejected: leaving questions in the steps panel (hidden), and rendering only the form (no answered-question history).

Cost: question parts add a few KB to the light payload; they are never lazily loaded.

## 2026-11-06 — Tab cycles chats

Context: the previous entry rejected Tab because it carries keyboard focus. The user confirmed Tab is only used to reach the attach and dictation buttons in practice and asked for Tab to cycle chats.

Decision: Tab and Shift+Tab select the next and previous chat in the sidebar order. The handler stands down while a dialog (settings, workspace picker) or an agent form has focus, so Tab still moves between their fields.

Why: the composer is where the user sits, and cycling from there is one keystroke. Alt+J/K stays as the modifier-safe alternative.

Rejected: hijacking Tab inside dialogs and forms (makes those screens unusable from the keyboard).

Cost: header and composer controls are no longer reachable with Tab. Replaces the Tab part of 2026-11-05 — Chat shortcuts.

## 2026-11-06 — Ctrl+Tab cycles chats

Context: bare Tab stole keyboard focus from the composer and from header controls, so the user asked to limit chat cycling to Ctrl+Tab.

Decision: Ctrl+Tab and Shift+Ctrl+Tab select the next and previous chat. Alt+J/K stays. Plain Tab goes back to normal focus movement and command completion.

Why: a modifier makes the intent explicit and leaves Tab usable inside text fields and dialogs.

Rejected: keeping both bindings (Tab keeps breaking focus) and meta+Tab (taken by the OS).

Cost: Ctrl+Tab is reserved by desktop browsers, so the shortcut works only where the page can capture it. Replaces 2026-11-06 — Tab cycles chats.

## 2026-11-06 — Keyboard-only undo and learning dictionary

Context: the `↶ word` toast added visual noise. The user wants a keyboard-only way to reject an auto-fix and wants project words such as `субагенты` to stop being flagged.

Decision: remove the undo toast. `Backspace` at the end of the corrected word or `Ctrl/Cmd+Z` restores it and adds the original to the personal dictionary. A word still flagged when sent three times is learned automatically. Add `субагент` and its Russian forms to the allowlist.

Why: the keyboard gesture is faster than moving to a toast, and repeated sent words are a stronger signal than a single typo. The allowlist fixes the immediate false positive without waiting for learning.

Rejected: keeping the toast, learning a word after one send (would learn typos too), adding every declined form to a hand-written list forever.

Cost: three sends are needed before a new project word is learned; the keyboard undo only works while the correction is recent. The personal dictionary stays in browser `localStorage`, so it is per browser.

## 2026-11-06 — File cards, media players and type icons

Context: attachments were rendered as an image, a PDF card or a bare link. Audio, video, archives and documents had no icon or player, and an assistant reply could not show files at all.

Decision: one shared `AttachmentPreview` renders by file type: image/GIF inline, audio and video with native `controls`, PDF with a browser preview, and every other file as a download card with a type icon. The same component handles user attachments, tool output and local `/api/file` links in markdown. Audio and video responses are served inline; HTML, SVG and other active content stay downloads.

Why: the browser already has media players and PDF viewing; the GUI only needs to pick the right element and icon. Reusing one component keeps message attachments, tool output and markdown attachments consistent.

Rejected: a custom audio/video player (extra controls and state), rendering every markdown link as a file card (breaks ordinary links), adding an icon package (lucide already has the needed file icons).

Cost: video seeking depends on the browser buffering the whole file because `/api/file` does not forward range requests yet; media links load when the message is rendered.

## 2026-11-06 — Frankfurt is the only runtime; capabilities stay server-side

Context: the GUI grew host-side services (OpenCode, LanguageTool, Whisper) and client-side ones (nspell in a browser worker, microphone capture, audio playback). The product needs one production instance on Frankfurt and must not depend on what a particular client has installed.

Decision: production runs only on the Frankfurt instance. OpenCode, nit-gui, Caddy, LanguageTool, Whisper and the TTS hub live there. The browser is a thin client: UI, microphone capture and audio playback only. New capabilities that need a model, dictionary, voice, JVM or another process are added as Frankfurt-side services behind `/api`, not as client-side dependencies. Browser `speechSynthesis` is not a TTS fallback.

Why: one host to deploy, supervise, back up and secure; the client may be any browser on any OS; shared models and dictionaries do not depend on the device.

Rejected: a local-first client with per-device TTS, STT or dictionaries; browser speech synthesis as a TTS fallback; keeping nspell in the browser indefinitely.

Cost: spelling still runs in the browser until `/api/spell` lands; the TTS hub must move from `0.0.0.0:7787` to loopback and be proxied; every capability shares one host's CPU and RAM; a down Frankfurt instance takes the whole product down. This supersedes the browser-only part of 2026-11-05 — Composer spelling and the nspell half of 2026-11-06 — Hybrid spelling and grammar.

## 2026-11-06 — Server password page and Funnel ingress

Context: the app is exposed publicly, but the only gate was Caddy basic auth on a plain-HTTP listener. The user wants a normal web login page, a password set on the server, and brute-force protection.

Decision: put authentication in the Go app. `bin/auth` generates a random password, stores a PBKDF2-SHA256 hash (600k rounds) in `~/.config/nit-gui/auth.env` with mode `0600`, and prints the password once. `/auth` renders the login page; a successful login sets an HttpOnly, Secure, SameSite=Strict session cookie. Five wrong passwords block an IP for 15 minutes; 50 failures across all clients block new logins for 5 minutes. Caddy binds `127.0.0.1:7792` and only proxies; Tailscale Funnel terminates public TLS at `https://frankfurt.tailf358cb.ts.net/nit/`. The app is served under `/nit` with a matching Vite base and API prefix.

Why: one place owns auth and rate limiting, the password never reaches Caddy or a URL, and Funnel provides HTTPS without opening the host's public IP or changing the OCI security list.

Rejected: keeping Caddy basic auth (no login page, no lockout), exposing the app or Caddy on `0.0.0.0`, using the host public IP with `nip.io` (80/7792 closed, 443 occupied), and a per-user account system (out of scope for one user).

Cost: one shared password, in-memory sessions and lockout counters, and no 2FA. Restarting the app signs everyone out and clears blocks. Public access depends on Tailscale Funnel; a real domain would need DNS and a free TLS port.

## 2026-11-06 — Tab belongs to text fields

Context: Tab cycled chats globally, but the composer needs it for autocomplete: the /command palette and the spelling/grammar suggestions popup.

Decision: the global Tab handler ignores events from inputs, textareas, selects and contenteditable elements. Inside the composer, Tab completes the selected /command or applies the first suggestion at the caret.

Why: Tab in a text field is the user's autocomplete key, and the composer is where it matters. Chat cycling still has Alt+J/K and Tab everywhere outside a field.

Rejected: keeping Tab global and letting the composer only handle the palette (the grammar popup would lose its key); dropping Tab cycling entirely.

Cost: Tab in the sidebar search now moves focus instead of cycling chats. Replaces the Tab part of 2026-11-06 — Tab cycles chats.

## 2026-11-06 — Prefetch full light transcripts before a chat is opened

Context: the cache was filled only when a chat was selected, so a long chat still opened with a 50-message tail and loaded older pages on scroll.

Decision: after the session list loads, fetch the full light transcript (`light=1`, no `limit`) for every non-running session in the background, newest first, two at a time. User messages, assistant text, questions and compaction are complete in the cache before the first open. Tool and reasoning payloads stay lazy and are fetched when a steps block or row is opened. The cache is bounded by 12 MiB only; the 30-chat cap is removed.

Why: the light transcript is small (all 73 local chats are about 7 MB), and prefetching it makes switching instant without downloading tool output or reasoning.

Rejected: fetching full transcripts on selection (delays first paint), prefetching running sessions (races with SSE and can cache a partial answer), and keeping a fixed chat count (evicts small chats for no reason).

Cost: the app downloads the text of every chat after boot; a failed prefetch falls back to the tail and retries on the next session refresh; a chat over 10,000 messages still needs scroll paging.

## 2026-11-06 — Visible-only cache and full transcript on open

Context: the cache kept tool and reasoning stubs, while opening a chat still loaded only the newest 50 messages. Older user messages, answers and questions were reachable only by scrolling, and that earlier-page loading was unreliable.

Decision: light mode now returns only the visible transcript: user messages, assistant text, question tools and compaction. Dropped reasoning and non-question tools become per-message `steps`, `tools` and `errors` counters. The cache stores only this visible form; tools and reasoning are never cached. Opening a chat fetches the full visible transcript with no `limit`, so all visible content is present without scrolling. Prefetch warms the same full visible transcript for other chats. The steps panel loads full messages on open and the cache strips them again on save.

Why: visible content should not depend on scroll timing, and a visible-only transcript is smaller (5.1 MiB vs 7.5 MiB for all 73 current chats).

Rejected: keeping tool/reasoning stubs in the cache, and tail-first loading with earlier pages fetched on scroll.

Cost: opening a long chat waits for one full visible request instead of a 50-message tail; steps are fetched again when opened and are not kept in the cache.

## 2026-11-06 — Mobile: bottom navigation and a bottom sheet

Context: on a phone the hamburger and subagent menu sat in the top bar, far from the thumb, and the session rail slid in from the left. The dimmed backdrop also sat below the composer, so taps reached the chat behind it. The animated background followed synthetic mouse events from taps.

Decision: below `48rem` the header keeps only the title (and the parent back button). Chats, new chat, subagents, settings and theme move into a bottom bar inside the dock, and the subagent menu opens upward. The session rail becomes a bottom sheet that slides up over a full-height backdrop above the dock. The background scene tracks the pointer only when `(pointer: fine)` matches. The app uses `100dvh` and the viewport opts into `viewport-fit=cover` for the safe area.

Why: the thumb reaches the bottom of the screen, the sheet keeps the chat visible above it, and a mobile tap must not move the desktop decoration or activate controls behind a modal.

Rejected: keeping the desktop rail on mobile, a full-screen sessions page, and drag-to-dismiss on the sheet.

Cost: mobile gets its own navigation surface and five bar buttons; the sheet has no swipe-down gesture, only the backdrop, Escape and session selection close it.

## 2026-11-06 — Hidden and done state move to the server

Context: hidden chats were kept in `localStorage`, and done/failed markers lived only in memory. Hiding a chat or seeing a completion on one device did not affect another device, which breaks the multi-device use case.

Decision: store hidden session IDs and done/failed status in `~/.local/state/nit-gui/ui-state.json` behind `/api/ui`. The browser keeps only device preferences, unsent drafts and the in-memory transcript cache. Clients load the state on boot, on focus and every 10 seconds; mutations are optimistic and saved through the API.

Why: hidden chats and completion markers are shared product state, not device preferences. A JSON file is enough for one user and avoids adding a database.

Rejected: keeping hidden state in `localStorage` (breaks multi-device), a database (overkill for one file), and syncing every preference to the server (theme, sidebar, drafts are device-specific).

Cost: last-write-wins, no push channel, and a done marker is only created by an open client that receives the idle event. The state file must be backed up with the rest of the instance.

## 2026-11-06 — Drafts and model/agent join the server state

Context: the user continues long prompts and reviews across devices and wants the same model and agent defaults everywhere. Drafts and those preferences were still `localStorage` only.

Decision: store drafts, preferred model and preferred agent in the same `ui-state.json`. Drafts are keyed by session ID or `new:<workspace>`, capped at 256 KiB, saved 700 ms after the last edit, and mirrored to `localStorage` only for instant load. The client resolves the initial value by `updatedAt`: the newer side wins, and a local draft is pushed when the server has none.

Why: these are shared product state, not device chrome. The local mirror keeps chat switching instant and survives a temporary server failure.

Rejected: keeping drafts local (breaks cross-device continuation), sending every keystroke to the server (wasteful), and a database (one JSON file is enough for one user).

Cost: two devices editing the same draft overwrite each other, last save wins. A draft over 256 KiB is rejected. Model/agent changes are also last-write-wins.

## 2026-11-06 — Named themes on top of the stock light/dark tokens

Context: the app only had light, dark and system, and `/theme` cycled them. The stock palette stays the default, but the product now needs classic palettes and a couple of authored ones.

Decision: keep the stock palettes on `:root` and `.dark`, and add named palettes as `[data-theme="..."]` blocks that override the same CSS variables on `<html>`. Theme ids and labels live in `web/src/lib/themes.ts`; `.dark` still marks the dark variant for Tailwind and existing observers, while `data-theme` picks the palette. `/theme`, the header button and the mobile button open a picker that applies a theme live. `system` resolves to stock light or dark from the media query.

Why: the token layer already drives every surface, so new themes need CSS only. The picker previews reuse the same variables, so a swatch cannot drift from the real palette.

Rejected: a stylesheet per theme and CSS-in-JS (more moving parts), and rewriting every `dark:` utility into per-theme variants.

Cost: each named theme must define every token, and the dark theme ids are repeated in the pre-paint script in `web/index.html`.

## 2026-11-06 — Mobile dock: session pill instead of bar buttons

Context: five equal buttons in the mobile dock spread the most useful controls, and the theme switch was rarely used there. The session title and status card stayed in the top bar, away from the thumb.

Decision: the mobile dock is the session pill (title, directory, agent/model, context, cost) with `+` and subagents to its right. Tapping the pill or swiping it up opens the sessions sheet; the sheet keeps Settings as its last row. Theme lives in Settings, so the dock has no theme button. Replaces the mobile bar part of 2026-11-06 — Mobile: bottom navigation and a bottom sheet.

Why: one wide target opens chats, one tap starts a new chat, and the rest sits behind a bottom sheet where the thumb reaches.

Rejected: keeping five icon buttons, putting Settings next to `+`, and a separate theme control in the dock.

Cost: opening chats requires a tap or an upward swipe on the pill instead of a dedicated hamburger icon; changing the theme takes two taps on mobile.

## 2026-11-06 — Instances are OpenCode servers behind one nit-gui

Context: the `nit` TUI treats an instance as one OpenCode server because the
client and the host are the same machine. In nit-gui the browser, the nit-gui
service and OpenCode can be on three different hosts, so a bare list of servers
hides who owns TTS, STT, spelling and shared state.

Decision: production runs one nit-gui service and fronts one or more OpenCode
servers, called instances. `instances.json` on the nit-gui host defines
`local`, explicit `url` and `ssh` instances. The browser sends
`X-Nit-Instance` (or `?instance=` for SSE and file links) and the backend routes
the request. UI state, drafts, hidden chats and done/failed markers are keyed by
instance. Only the active instance keeps an event stream.

Why: the nit-gui host owns auth, redaction, shared state, STT and grammar, which
the browser must not own. The OpenCode server owns sessions, models, agents and
workspaces. This keeps the TUI model where it fits and makes the split visible
in the Instances menu instead of implicit.

Rejected: many nit-gui deployments called instances (different origin, login
and state, and no reusable SSE); a browser talking to bare OpenCode (service
password in the browser, no shared state, no server STT or grammar); combined
tabs and background SSE for every instance (connections and unread state for a
screen that shows one chat).

Cost: switching remounts the chat view and reloads the transcript; inactive
instances do not accumulate unread or approvals; SSH tunnels are not
auto-reconnected; config changes need an app restart.

## 2026-11-06 — Browser voice is a labeled device TTS fallback

Context: the reply `Read` button calls `speechSynthesis`, while the 2026-11-06
Frankfurt boundary said the browser must never synthesize speech. The
Instances menu needs to describe speech honestly.

Decision: keep the browser voice as an explicit device fallback. The backend
reports host speech as `off` until the OpenCode TTS hub is proxied; the
Instances menu upgrades `speech` to `fallback` only when the browser exposes
`speechSynthesis`, with owner `browser`. Host TTS is never implied.

Why: removing a working read-aloud button is a user-visible regression, and
hiding the fallback would make the capability matrix lie. Labeling the owner
fixes the contradiction without pretending the device is the host.

Rejected: removing `speechSynthesis` until the hub is proxied; reporting
device speech as host TTS.

Cost: speech quality and voice availability depend on the device; a browser
without a voice gets no speech. This supersedes the TTS clause of the
2026-11-06 Frankfurt-only decision.

## 2026-11-07 — Earlier pages load at the top and keep loading there

Context: earlier-page loading was driven only by scroll events. At `scrollTop = 0` a new event never fires, so the user hit the ceiling and had to scroll down and up to trigger the next page.

Decision: `shouldLoadEarlier` treats the exact top (and negative overscroll) as a load trigger. After a page lands while the viewport is still at or near the top, the effect keeps loading until the viewport is pushed past the threshold or there are no earlier pages. Wheel, touch and keyboard gestures at the top also request a page, which gives a retry after a failure. A failed earlier request keeps the cursor and shows the error instead of disabling the cursor; a stale request is ignored by session and request tokens.

Why: the top is the only place where scroll events cannot express intent, so it needs an explicit trigger and a continuation rule.

Rejected: requiring a scroll-down before retrying, and clearing the cursor on every earlier-page error.

Cost: staying at the top loads the remaining history in a chain; the loading pill stays visible while it runs.

## 2026-11-07 — Instances are edited from the UI, config stays server-side

Context: the first Instances menu was read-only. It showed the stack and
capabilities but could not switch (one instance), add, edit or delete anything,
so it was a dead end. The user asked for a window with a purpose.

Decision: the authenticated Instances menu creates, edits and deletes entries.
`POST /api/instances` validates and writes `instances.json` on the nit-gui host,
then reloads the registry in place. A password typed into the form is written to
a separate `0600` file next to the config and is never returned to the browser.
Renaming moves the instance's `ui-state` entry. Deleting keeps that state, so
recreating the name re-attaches it.

Why: the config belongs to the host, not the browser, and the app already owns
the auth boundary. Editing through the UI removes the "edit a file and restart"
step without weakening the rule that secrets stay server-side.

Rejected: editing `instances.json` only from a shell (the menu stays a dead
end); storing secrets in `localStorage`; hot-reloading the whole process (the
registry reload is enough).

Cost: the menu now has a form and error states; an external edit is only picked
up on reload/restart; the password file is an extra file to back up; deleting an
instance leaves its drafts and hidden chats in `ui-state.json`.

## 2026-11-07 — Host TTS is proxied to the OpenCode TTS hub

Context: the TTS hub on `127.0.0.1:7787` was running, but nit-gui never talked
to it. The menu reported `off`, and the reply `Read` button only used the
browser voice. The user expected host TTS to be connected.

Decision: nit-gui publishes reply text to the hub through
`POST /api/tts` (Bearer token read from the host, never sent to the browser).
The menu probes `/health`: `on` with an audio client, `fallback` when the hub is
up but no audio client is connected, `off` when the hub is down. The reply
`Read` button tries the host first and falls back to the browser
`speechSynthesis` only when the host path fails. The token file is
`${XDG_STATE_HOME:-~/.local/state}/opencode-tts/token`; `NIT_GUI_TTS_URL`,
`NIT_GUI_TTS_TOKEN_FILE`, `NIT_GUI_TTS_TOKEN` and `NIT_GUI_TTS=off` configure it.

Why: the hub is the existing host-side path; proxying it keeps the token out of
the browser and preserves the "thin client" boundary. Publishing text is the
hub's actual contract; it broadcasts to an audio client rather than returning
audio.

Rejected: synthesizing audio in the browser as the primary path (device voices,
not host); adding a second host synthesizer (duplicates the TUI's speech
engine); returning the hub token to the client.

Cost: the hub needs a connected audio client; with none, the UI falls back to
the device voice or `off`. The hub still binds `0.0.0.0:7787` and is protected
only by its token.

## 2026-11-07 — Host voice synthesis is the second TTS path

Context: proxying the OpenCode TTS hub was not enough. The hub only broadcasts
text to an audio client; with no client connected the GUI still had no host
voice. The user expected host TTS to work out of the box.

Decision: nit-gui synthesizes on the host with `piper` (local) or `edge-tts`
(network) and serves the audio from `POST /api/tts/audio` when the hub has no
audio client. `auto` prefers piper; `NIT_GUI_TTS_ENGINE` forces piper/edge/off.
The reply `Read` button tries the hub, then host voice, then browser
`speechSynthesis`. The Instances menu reports host voice as `on`, device voice
as `fallback`, and no path as `off`.

Why: the host already has both engines and a Russian piper voice; reusing them
makes speech work from any browser without a local voice. Piper keeps the reply
local; auto avoids the network path unless edge is the only engine.

Rejected: requiring the user to keep an external audio client connected;
browser speech as the primary path; streaming per sentence (not needed yet).

Cost: the first piper call loads a ~63 MB model; long replies take seconds and
need a cancel; edge-tts sends reply text to the network; each read synthesizes a
temporary file under `/tmp`.

## 2026-11-07 — Instance config edits from the browser are untrusted input

Context: the Instances menu now writes `instances.json` from a browser form, so
`ssh` and `passwordFile` no longer come only from a root-owned file.

Decision: validate every SSH host against a strict host grammar before it
reaches `ssh` (no leading `-`, no whitespace or shell characters) and add
`BatchMode=yes`; accept a browser-supplied password file only inside the nit-gui
config directory, reject symlinks and non-regular files, and derive the default
path from the instance name. Existing configs keep working; the browser cannot
choose an arbitrary host path.

Why: `ssh -oProxyCommand=...` executes a command and a writable password path
can overwrite `~/.ssh/authorized_keys`; a shared GUI password must not become a
host shell or host file write.

Rejected: trusting the form, and blacklisting only `ProxyCommand` (other ssh
options remain dangerous).

Cost: custom password files outside `~/.config/nit-gui/` are no longer accepted
from the menu; a host alias must look like an ssh host, not an option.

## 2026-11-07 — Permission requests are a first-class UI state

Context: OpenCode v2 exposes permission requests separately from forms, and an
agent blocks until one is answered.

Decision: proxy `GET /api/sessions/{id}/permissions` and the reply endpoint with
`once`/`always`/`reject`; show one card above the composer, poll pending
requests for running and background chats, include them in waiting markers and
notifications.

Why: pre-approving every action is unsafe, and a GUI with no approval card
makes ordinary file or shell tools hang.

Rejected: auto-approving everything, and showing permissions only for the
selected chat (a background run would stay blocked silently).

Cost: one extra poll per running or waiting chat every five seconds.

## 2026-11-07 — Attach on Send; clear drafts with a tombstone

Context: uploading on selection left every removed or unsent file in `/tmp`,
and deleting a cleared draft made another device resurrect its old copy.

Decision: keep the browser `File` until Send and upload then; store a cleared
draft as an empty draft with `updatedAt` instead of deleting it. Clients apply
remote text or a clear only when its timestamp is newer than the local mirror,
so an edit on another device still wins.

Why: no files are written for drafts that never send, and a send on one device
clears the same draft on the others without losing a genuinely newer edit.

Rejected: a periodic `/tmp` sweep (it can delete files old transcripts still
need), and clearing only the local mirror (the stale copy comes back).

Cost: a failed upload after earlier files were uploaded can leave those earlier
temporary files behind; sent files still need a separate cleanup story.

## 2026-11-07 — Questions inline in the composer; answers as chat bubbles

Context: multi-field question forms appeared as a separate card above the
composer, and answered questions stayed a tool card inside the assistant turn.
Both hid the conversational shape of the exchange.

Decision: render every string question form inside the composer with `1/N`
steps, `Next`/`Back` and a final `Answer`. After the reply, show the question as
assistant text and each answer as a right-aligned bubble with a quoted question,
time and double check. Non-string forms still use the form card.

Why: the request and the reply read like a normal chat, while the composer keeps
focus and draft behavior for the active answer.

Rejected: a separate step card above the composer, and answers only inside the
tool card.

Cost: question forms with non-string fields keep the old card and do not get the
step UI.

## 2026-11-07 — Older chats fold behind the existing button

Context: the sidebar listed up to 100 sessions, so chats from previous days
stayed mixed with the current work. Hiding them through `hiddenIds` would mix
automatic and manual state, inflate the hidden count and deselect an open chat.

Decision: a derived 12-hour window. A scope with more than ten top-level chats
shows only chats updated in the last 12 hours; older ones stay loaded in the
browser behind `Load older chats (N)`. The selected, running and waiting chats
are always kept, and search ignores the cutoff. When the scope has ten or fewer
chats, all are shown. Nothing is written to `ui-state.json`.

Why: the list stays focused without changing shared hidden state, and
`Load older chats` still pages upstream once the local older set is revealed.

Rejected: auto-writing old IDs to the shared hidden list, and a persisted
"recent only" preference.

Cost: "inactive" means no session update for 12 hours, not "not opened"; a chat
read without new messages can leave the list once it is no longer selected.

## 2026-11-07 — Read aloud streams piper and rewrites Markdown for speech

Context: the reply `Read` button synthesized the whole answer before returning
audio. A 1500-character answer took 15 seconds and a 3000-character answer hit
the 60-second host timeout, so the user saw a spinner and heard nothing. The
OpenCode TTS hub had no connected audio client, so publishing to it was a dead
path for the GUI.

Decision: the browser is the speaker. `Read` splits the reply into paragraphs
and sentences and calls `POST /api/tts/stream`, which runs `piper` with
`--output_raw` and forwards 16-bit mono PCM as it is synthesized; the browser
schedules it with Web Audio. The next segment is prefetched while the current
one plays. The server rewrites Markdown before synthesis: fenced code becomes
`Блок кода на Go, 12 строк`, paths become `файл tts.go в папке internal
server`, bare URLs become `ссылка на <host>`, tables become `Таблица`, long
hashes become `хеш`, flags are read as `флаг`. Selecting text in a reply makes
`Read` speak the selection. The fallback order is streamed piper, whole-file
`edge-tts`/piper, TTS hub, browser voice.

Why: the first audio now starts in 0.5–1.7 seconds, piper stays local, and
removing code and paths from the spoken text cuts synthesis time without
losing the context: the listener hears what the block is and where the file is.
Measured on Frankfurt: piper medium, 370 characters, 2.9 seconds of synthesis,
0.47 seconds to the first chunk; edge-tts 1.2 seconds warm but 12.7 seconds
cold.

Rejected: waiting for the whole reply (the current regression), making
`edge-tts` the default (cloud and slow cold start), requiring an external audio
client, and reading code and paths literally.

Cost: piper still loads a ~63 MB model per segment, so with many short
paragraphs the next segment can be late; a persistent piper worker is the next
step. Web Audio must be unlocked by the click; browser speech remains the last
fallback. Auto-read of new replies and starting from an arbitrary line are not
part of this change.

## 2026-11-07 — Remove edge-tts and keep one warm piper worker

Context: the first streamed reading version used `edge-tts` as a whole-file
fallback. It sends reply text to Microsoft and its cold start measured 12.7
seconds. The user rejected it. Separately, each streamed segment started a new
piper process and reloaded the ~63 MB model, so later segments could wait.

Decision: piper is the only host engine. `NIT_GUI_TTS_ENGINE` accepts `auto`,
`piper` and `off`; the edge binary, voice and env vars are gone. The server
starts one piper process with `--json-input` during warmup and keeps it loaded
(~140 MB RSS). Segments are serialized through it; each segment is written to a
temporary WAV file named in the JSON line, then streamed to the browser as PCM.
A crashed worker is restarted on the next segment; a 60-second timeout kills
and restarts it.

Why: one local engine removes the cloud path, the 12.7-second cold start and
the second set of voice settings. The warm worker keeps the model resident, so
the first segment is about 0.9 seconds after a restart and later segments are
about 0.5 seconds. Firefox and Chrome both support the streaming fetch and Web
Audio APIs this uses.

Rejected: keeping edge-tts as an optional engine, spawning a process per
segment, and a worker pool (one listener is the product).

Cost: the server holds one piper process and ~140 MB more memory after warmup.
One worker serializes segments; several simultaneous listeners would queue. A
worker crash costs one restart and the current segment.

## 2026-11-07 — GigaAM v3 for host dictation instead of whisper-small

Context: browsers without Web Speech (Firefox, Electron) fall back to host STT.
On this 4-core host a 1–6 second segment took 12–17 seconds with
`whisper-server` and the small model, and small Whisper does not punctuate
Russian reliably.

Decision: `bin/gigaam` runs GigaAM v3 CTC with punctuation through sherpa-onnx
(217 MB ONNX, MIT) on `127.0.0.1:8177`. `bin/deploy` starts the sidecar and
exports `NIT_GUI_STT_FAST_URL`; the Go fast path posts raw 16 kHz WAV there and
does not spawn `whisper-server`. If the sidecar cannot start, the deploy leaves
the URL unset and the old whisper path remains.

Why: measured RTF 0.10–0.13 on this host, so a 5-second segment returns in
about 0.4–0.6 seconds with commas, full stops and capitals. The app already
defaults to Russian, so the model's Russian-only coverage matches the product.

Rejected: whisper `tiny`/`base` (still slower and less accurate), browser Web
Speech in Firefox (Mozilla does not ship it), cloud STT (needs keys and sends
audio out), Vosk WASM (no punctuation, lower accuracy).

Cost: one Python venv with `sherpa-onnx`, about 300 MB RSS while warm, and a
156 MB one-time model download. English or mixed-language host dictation is no
longer covered by the fallback.

## 2026-11-07 — The new-chat scene fades out when a chat starts

Context: the animated canvas background lived only on the empty new-chat
screen. The first prompt created a session, the canvas unmounted, and the UI cut
straight to the plain background.

Decision: keep the canvas mounted across the empty and transcript branches,
fade it out over 500 ms, and pause its animation. Returning to a new chat
remounts the scene and fades it in.

Why: the transcript is a reading surface; moving lines behind long answers hurt
readability and cost battery, while the empty screen has nothing else to
compete with the scene.

Rejected: a permanently animated background in chat, a dimmed version in the
side gutters, and a static tinted snapshot of the scene.

Cost: one canvas backing store stays allocated while a chat is open, and the
scene freezes during the 500 ms fade instead of continuing to animate.

## 2026-11-07 — Review queue is a file, not a second store

Context: a deferred card needs a place to come back to, and the app must show the current declaration without becoming a dashboard.

Decision: `docs/review/queue.json` is the only queue. The curator writes it; the app reads it through the instance fs API and sends accept or reject as a prompt to the curator session. "Later" is a 24-hour local snooze.

Why: repo files diff and survive clients; the app stays a reader; vault writes happen only after an explicit "Accepted" prompt.

Rejected: SQLite or app-side review state (a second source of truth); editing vault from the UI (two write paths); a separate tab (a dashboard).

Cost: decisions are asynchronous, up to one model turn each; the queue refreshes on a 10-second poll.



## 2026-11-09 — One stateless gate for nit-gui, pero-gui and term-gui

Context: the three apps each had their own password, cookie name and in-memory session map. Every restart logged the user out, and a login in one app did not open the others.

Decision: all three verify the same PBKDF2 hash from `~/.config/nit-gui/auth.env` and accept one HMAC-signed `nit_gate` cookie on path `/`, carrying only an expiry seven days out. The apps stay independent processes; no central auth service or proxy was added.

Why: a signed expiry needs no shared store, survives restarts naturally, and works across ports because cookies are host-scoped. Rotating the password changes the hash and invalidates every session.

Rejected: Caddy forward-auth in front of all three (term is funneled on its own port, so it would need a new proxy layer); shared session database (new service and dependency); per-app cookies with a shared secret (still three prompts).

Cost: the same small token and PBKDF2 code is duplicated in three repos; logout clears the cookie, but an already copied token stays valid until its expiry; the tailnet IP and the public hostname still require separate logins.

## 2026-11-09 — One login page, at nit-gui

Context: after sharing the cookie, pero-gui and term-gui still served their own `/auth` forms, so there were three entry points and three lockout policies for one password.

Decision: `https://frankfurt.tailf358cb.ts.net/nit/auth` is the only login and logout page. pero and term keep only the shared `nit_gate` verifier and redirect unauthenticated pages to `NIT_GATE_LOGIN_URL?next=<absolute URL>`; their own `/auth` and `/auth/logout` routes return 404. nit accepts an absolute `next` only for http/https URLs on the same hostname with a path under `/nit/`, `/pero/` or `/term/`.

Why: one form means one password check and one lockout; the absolute `next` returns the user to the original page across the two public ports and hostnames.

Rejected: hidden local forms that share the cookie; a shared auth proxy in front of all three; trusting arbitrary absolute return URLs.

Cost: nit must know the three path prefixes, and pero/term build the absolute return URL from forwarded headers.


## 2026-11-09 — Drop lives in nit-gui, not a fourth service

Context: the user wants a temporary buffer for files, HTML pages, full web apps and a docs reader that the agent can publish to.

Decision: serve `/nit/drop/` from the nit-gui process, with a Go file store, a server-rendered UI, `github.com/yuin/goldmark` for Markdown, and a `bin/drop` CLI. The public URL stays under `/nit`, so the existing Funnel mount, Caddy, auth cookie and deploy path are reused.

Why: a fourth binary would duplicate the gate, deploy and port, while Tailscale strips a new `/drop` path mount before Caddy can route it. Keeping drop inside nit-gui gives one login and one deploy; the agent gets a real command in PATH and a rule in AGENTS.md.

Rejected: a standalone drop-gui service (duplicate auth/deploy); a new `/drop` Funnel path (the prefix is stripped, so it would collide with the nit SPA); rendering docs in the chat (no stable links, no app hosting); storing uploads in the browser (no cross-device buffer).

Cost: nit-gui gains a file store and a Markdown dependency; uploaded HTML runs in a sandbox without network or forms; drop links require the same login, so they are not public.

## 2026-11-09 — Edited files travel inside the light transcript

Context: collapsed chats load a light transcript with text and step counters only. Edited files lived in tool metadata, so the reply footer showed nothing until every step message was loaded.

Decision: light messages now carry a deduplicated `edited` list (path, additions, deletions). The reply footer renders one "N files" toggle from those markers; once a message's steps are loaded, its tool parts replace the markers.

Why: the count and the hidden file list must be available without fetching tool output, and a few short strings per message fit the existing 12 MB transcript cache.

Rejected: loading full step messages just to build the list (defeats the lazy cache); caching only a count (the expanded list would still need a heavy fetch); a separate file-summary endpoint.

Cost: light transcripts and the cache grow slightly; paths are not normalized, so the same file recorded once as absolute and once as relative counts twice.

## 2026-11-09 — Pero deep links carry the agent and the changed lines

Context: file chips opened pero with a bare path. Relative tool paths failed with "not found", the editor did not point at the edited lines, and pero could not tell which agent produced the change.

Decision: nit-gui resolves paths against the workspace and adds `lines` (new-file ranges derived from tool patches) and `agent` to the existing `?open=` link. Pero parses them, scrolls to the first range, highlights every added line, and shows the agent in a banner above the editor.

Why: tool metadata already contains unified patches, so the ranges need no new endpoint, extra fetch, or diff view.

Rejected: a separate changes API in pero (nit-gui already has the patches); a standalone diff view (the user wants the real file); making pero guess the project root from a relative path.

Cost: the query string becomes a small contract between the two repos; ranges only cover patches present in tool metadata, so a pure write opens the file without a highlight.



## 2026-11-09 — Drop becomes a public file host, not a reader

Context: the seven-day buffer and its Markdown reader duplicated pero, wrapped every entry in a page and iframe, and made sharing a file require the nit password.

Decision: entries get a mutable slug, aliases, a public flag and an optional expiry; the manager stays at `/nit/drop/` behind the cookie, while public content moves to `/nit/d/`. Publicity is per publication. Old `/drop/e/`, `/drop/files/`, `/drop/download/` and `?file=` URLs redirect to the slug URL. Markdown rendering, the reader, previews and goldmark are removed; Markdown opens in pero instead.

Why: one publication is one link, one visibility switch and one asset graph; direct URLs are what recipients need, and the browser already renders PDF, images and HTML.

Rejected: per-file visibility, reader wrappers, iframes and a second public toggle for downloads.

Cost: public HTML is anonymous hosting on the same origin, so the CSP sandbox and no-index headers are part of the contract; slug changes rely on the alias list, and old links live forever in `entry.json`.

## 2026-11-10 — Composer input: mobile focus, hint flip, steady underlines, Tab indents

Context: on a phone the keyboard opened on every entry into a chat; the floating suggestion bar sat on the word's line and covered the text; red underlines vanished on every keystroke; `Tab` in the field only moved focus out.

Decision: the field self-focuses only on `pointer: fine`; the suggestion bar sits below the word when it fits and flips above otherwise; stale issues are kept until the next check returns and dropped only after the first edited character; `Tab` completes `/commands`, accepts the highlighted suggestion, otherwise inserts two spaces, while `Esc` blurs the field and `Shift+Tab` still leaves it. Send-time checking and LLM proofreading were rejected.

Why: live Hunspell underlines are free and instant; an LLM call per message is slower and less precise on single words, and a blocking gate adds friction. One meaning for `Tab` plus an explicit exit is learnable.

Rejected: an LLM spell check before send; a blocking "N mistakes, send anyway" gate; a fixed suggestion strip under the input; double-`Tab` for switching chats (`Ctrl+Tab` already does it).

Cost: `Tab` no longer reaches the Send button from the field; in the question form `Tab` keeps the browser default; a stale underline keeps its old position for the ~300 ms until the recheck lands.

## 2026-11-10 — Sidebar swipe works with fingers on tablets

Context: the sidebar had trackpad-wheel swipe on desktop and a bottom sheet on phones. A tablet with the persistent sidebar had no gesture at all: only the header button.

Decision: at `min-width: 48rem` the swipe also accepts touch pointers. Dragging the sidebar left hides it — one-to-one with the finger in "Swipe · follows fingers", a 48 px trigger in "Button + swipe". Pulling right from the left 8 px strip brings it back. Finger direction maps the opposite way to the wheel (right opens). A drag suppresses the click that follows it, and the chat list gets `touch-action: pan-y` so vertical scrolling still wins.

Why: a 280 px panel over the header button is the slowest thing to toggle; on a tablet a horizontal drag is the shortest path, and the follow mode reuses the existing animation.

Rejected: edge-swipe only (system back gestures can swallow it, the strip is a fallback); dragging right anywhere in the transcript (fights with horizontal code scroll); a two-finger gesture (undiscoverable).

Cost: the left 8 px of the screen no longer click through at md+, and iOS/Android edge-back can still win at the very edge, so the header button remains the reliable path.

## 2026-11-10 — Draft attachments survive a chat switch

Context: an unsent photo or file disappeared whenever the user opened another chat and came back, and again after a reload. The draft text already survived both.

Decision: keep the composer remounted and keyed per chat as before, but store the unsent `File` objects under the same draft key in IndexedDB (`nit-gui.draft-files`) and restore them on mount. Sending or clearing the input deletes the record. Previews are recreated from the restored files. This replaces the "attachments are dropped on a switch" part of 2026-11-06.

Why: IndexedDB stores `File` objects directly, so the same object that was picked is uploaded at send time; nothing is written to the user's workspace until send, and `localStorage` cannot hold 20 MiB payloads.

Rejected: uploading on attach (litters the project before the user sends), base64 in `localStorage` (quota), lifting the attachment list into App state (still lost on reload), a serialized upload queue (not needed once the file itself is stored).

Cost: unsent files take disk in the browser profile, a draft that is never sent keeps them, and the attachments are per device.

## 2026-11-10 — The selected chat moves the project

Context: after picking a chat from another directory in `All chats`, the workspace stayed the old project: the sidebar header named it and the directory tab listed its chats, while an unrelated chat was open.

Decision: derive the workspace from the selected session — whenever the selected chat belongs to another directory, `workspace` and `nit-gui.workspace` switch to that directory, including on restore after a reload. The scope tab is left as the user set it.

Why: one chat can only live in one directory, so the project the app shows must be the project of the open chat. Doing it in one effect on `selectedSession` covers the sidebar, notifications, subagents and reloads.

Rejected: switching the scope to the directory tab automatically (moves the user out of `All chats` against their choice), rewriting the selected chat when the project changes (the inverse bug).

Cost: picking a chat in `All chats` rewrites the remembered workspace, so the next `New chat` starts in that directory.

## 2026-11-10 — The sidebar has one mode: a button and a swipe

Context: "Button + swipe", "Hover at the left edge" and "Swipe · follows fingers" split one panel into three behaviours. The last two draw the sidebar over the chat instead of pushing it, which the user rejects; the setting itself was the only way to find them.

Decision: the setting is deleted. The sidebar is always a normal flex column that collapses to zero width, toggled by the header button, a horizontal swipe on the panel (left closes), or a right pull from the left screen edge. The follow-finger mode and its `--sidebar-swipe` CSS, `advanceSwipe`, `settleSwipe` and the `sidebar-mode` key are removed; the trigger threshold (48 px) stays. Stored `nit-gui.sidebar-mode` values are ignored.

Why: one behaviour needs no explanation, keeps the layout stable, and the slide-over panel covered the conversation.

Rejected: keeping the modes behind a hidden default (a setting nobody needs and a code path per mode); animating width from the finger (the panel is in flow; width can't follow a gesture cheaply).

Cost: no more hover peek and no drag-to-resize; users who liked the slide-over panel lose it, and the stored mode value stays dead in localStorage.

## 2026-11-10 — All chats: stable project order, smooth scope label

Context: switching the project in `All chats` moved that project's group to the top and reset the list scroll, so the list jumped right under the pointer. The project name in the scope tab swapped without a transition.

Decision: drop the "current project first" rule from `groupByDirectory`. Groups are ordered by their newest chat, ties broken by directory; selecting a chat never reorders them. The scroll reset now runs only in the directory scope, where the list content really changes. The project label in the scope tab fades in with `sidebar-sheen-scope-in` (200 ms) and is skipped for reduced motion.

Why: ordering should change only when a chat gets new activity, so the eye never has to re-find a chat after navigating. Project order by recent activity already keeps the project you work on near the top.

Rejected: animating the current project to the top (movement at the moment of a click), freezing order on entering the tab (surprising after activity).

Cost: the current project is no longer guaranteed to be first; finding it in a long pool means scanning the headings or using search.

## 2026-11-10 — Finished chats leave their project group in All chats

Context: in `All chats` the sidebar grouped every chat by project, so a chat that just finished rose to the top of its own project but stayed wherever that project sorted. A finished chat in an idle project stayed below newer projects.

Decision: finished, waiting and failed chats from every project are hoisted into one unlabelled flat block above the project groups; their subagents move with them. Rows keep the project line because the group header is gone. The remaining chats stay grouped by directory and running chats stay docked at the bottom. `hoistFinished` in `web/src/lib/sessions.ts` does the split.

Why: completion is the strongest signal in the list, so it should not depend on which project produced it. No new control: the existing rank already marks these chats.

Rejected: a separate "Finished" heading (visual noise the user does not want); a flat activity mode with a toggle (a second list mode for one need); sorting whole projects by their newest finished chat (the finished chat still sinks with its project).

Cost: hoisted chats mix projects, so the project line is their only context; a project heading no longer counts those chats.

## 2026-11-10 — Stopping the first message returns to the workspace picker

Context: a new chat is created in the remembered workspace on the first prompt. Stopping that prompt left an empty chat in the wrong project, and the next prompt had no way to choose another one.

Decision: when the first prompt of a freshly created chat is interrupted before any assistant message, the chat is deleted, its text returns to the composer, and the workspace picker opens. Picking a directory carries the text into the new composer. A chat that already has an assistant reply is never deleted, and a second user message also keeps it.

Why: an interrupted first prompt has no conversation to preserve, and choosing the project is part of starting a chat.

Rejected: keeping the empty chat and only opening the picker (the next prompt still lands in the old project); asking for confirmation (one extra dialog after an explicit stop).

Cost: the cancelled chat disappears from the list, and its attachments are not restored with the text.

## 2026-11-11 — Drop hosts one container with SQLite

Context: drop could run a container, but a React app with a server had nowhere to keep data and no way to pass secrets. Every restart removed the container filesystem, so SQLite was lost.

Decision: keep one rootless container per service. `drop.json` gains `env`, `env_file` and `volume`; `drop update` rebuilds while the old container runs, then restarts it. SQLite is the only database: no Postgres, no compose, no second container. Workers run inside the same container.

Why: one volume and one container cover personal apps without an orchestrator, and a pause of a few seconds during deploy is acceptable.

Rejected: compose with Postgres and Redis (operation cost for a need that does not exist); a zero-downtime port swap (not needed); running the app as a plain systemd process without a container (no isolation).

Cost: a worker cannot scale separately, data lives outside the entry and is not deleted by `drop rm`, and an update drops live WebSocket and SSE connections.

## 2026-11-14 — Dictation leaves nit-gui

Context: dictation was a client-side browser API with a host fallback through `/api/stt`, `whisper-server`, `whisper-cli` and a GigaAM sidecar. The user wants dictation treated as a client problem, not a service feature, while keeping room for better STT later.

Decision: remove the mic button, Web Speech wiring, audio capture, `/api/stt`, Whisper and GigaAM from nit-gui and the deploy. The composer stays a plain textarea, so OS and browser dictation type into it unchanged.

Why: audio capture and STT models were the only client-hardware dependency left in the service, and the device already has dictation that is faster and better than the host fallback.

Rejected: keeping Web Speech as an app feature (still client-side, but more code to own); keeping the host fallback behind a flag (models, ports and startup cost for a path the user does not want).

Cost: Firefox and other browsers without system dictation lose the mic button; returning server STT needs a new optional capability and endpoint.

## 2026-11-15 — Scope switch shows the target list immediately, without cross-list animation

Context: switching between `This project` and `All chats` painted the new scope with the old scope's sessions until its own fetch returned, then the list reordered. The FLIP pass animated rows from their old scope positions into the new list, so the swap read as a twitch.

Decision: a scope switch resets the FLIP baseline and scroll like a different list. When leaving `All chats` for the directory, the current pool is filtered to the workspace in memory; when leaving the directory for `All chats`, the last pool is restored from a cache that keeps refreshing in the background while the directory scope is active. The expected fetch still runs and corrects the list.

Why: the hidden scope has no DOM, so it cannot animate; the fair fix is to hand over data that is already current and treat the list as replaced.

Rejected: keeping both lists mounted (double DOM for a tab switch); delaying the tab until its fetch finishes (visible lag on every press); animating rows between scopes (the motion the user rejects).

Cost: while the directory scope is open, each refresh also fetches the top page of all sessions; the restored pool lacks subagents until its own fetch returns.

## 2026-11-15 — No `Load older chats`; the list pages on scroll

Context: the 12-hour window hid most of the sidebar (88 of 100 loaded chats were
older than 12 hours) behind a button the user called bad. The same button was
also the only way past OpenCode's first 100 sessions.

Decision: the recency window and its button are gone, and every chat in the
scope is listed. Reaching the end of the list scrolls in the next 100 upstream
sessions automatically; if the list is shorter than the sidebar, the next page
is requested as soon as the page renders.

Why: hiding chats and asking the user to reveal them was a step that only lost
information; paging belongs to scrolling.

Rejected: keeping the window with infinite scroll (still hides chats); loading
all pages up front (unbounded requests on a heavy instance).

Cost: a large instance makes one extra request each time the list reaches the
bottom, and search still goes upstream instead of filtering the loaded window.

## 2026-11-15 — All session pages load up front (replaces scrolling pager)

Context: the scroll pager replaced the button, but a list that starts at 100 and
grows on scroll still moves under the finger, and the first paint was one page
short of the truth.

Decision: `api.allSessions` walks the cursor until a short page, and both the
scope load and the `All chats` pool cache use it. No cursor state, no pager, no
scroll handler in the sidebar.

Why: the list is a view of the instance, not of a page of it; a stable list at
first paint beats requests saved.

Rejected: scroll paging (moves rows while the user reads), a manual button (the
step the user rejected).

Cost: a reload costs one request per 100 sessions; the walk stops at 100 pages
(10,000 sessions) as a guard against a runaway cursor.

## 2026-11-15 — Touch screens: native spellcheck, Enter inserts a line

Context: on a phone the custom wavy underline drifted off the word, the
replacement chip duplicated what the keyboard's T9 already offers, and Enter
sent the message while the user wanted a new line for indents.

Decision: on `pointer: coarse` the composer does not run the nspell worker, the
underline layer or the replacement chip, sets `spellcheck` on the textarea so
the system checker owns squiggles and suggestions, and Enter inserts a newline
in both the message field and the question form; Send and Answer buttons are
the only submission paths. Desktop keeps the current behavior.

Why: the underline is a second text layout that must match the textarea
exactly; the system checker measures the real one. One Enter meaning per
platform is learnable, and the footer hint says which one applies.

Rejected: a smaller or lighter custom underline (same layout coupling), a
per-word check on a timer (more worker traffic, still misaligned), sending on
Enter with a modifier (no modifier key reachable from the phone keyboard).

Cost: auto-fix and the personal dictionary do not run on phones; a tablet with
a hardware keyboard also needs the button to send.

## 2026-11-15 — A third sidebar scope: All machines

Context: with more than one OpenCode instance the sidebar showed only the active
machine. Finding a chat again meant remembering which machine it lived on, then
switching instances and losing the list.

Decision: add `All machines` next to `This project` and `All chats`. It fans out
one sessions request per connected instance, tags every row with its instance in
a small pill, and keeps the existing grouping by directory. Opening a chat that
belongs to another instance switches the instance first and then opens it.

Why: the user reads chats by directory, not by machine, so the machine belongs
as a label on the row, not as a second level of grouping. Fan-out in the browser
keeps the server free of a cross-instance session model.

Rejected: a server-side merged sessions endpoint (one more API shape to keep in
sync with OpenCode), grouping by machine instead of directory (the user asked for
directory separation), one event stream per instance (the SSE proxy is per
active instance by design).

Cost: live events, drafts and done/failed markers still belong to the active
instance; the merged pool refreshes on scope entry and on reconnect, so a chat
on another machine can show a stale status until then.

## 2026-11-15 — Editor and terminal addresses belong to the instance

Context: `NIT_GUI_PERO_URL` and `NIT_GUI_TERM_URL` described one host, so every
instance opened Frankfurt's editor and terminal. A file chip from a nixos chat
landed in a Frankfurt editor that cannot see that path.

Decision: `peroURL` and `termURL` become optional instance fields in
`instances.json`, accepted as an absolute `http(s)` URL without credentials or a
path starting with `/`. Empty means the host-wide env default, so an existing
file keeps its behavior. `GET /api/config` resolves the active instance's value,
`GET /api/instances` also reports the defaults, and the admin API treats a
missing field as "keep" and `""` as "clear".

Why: the editor and the terminal are per machine by nature, and the browser
already receives every instance-scoped URL through `/api/config`.

Rejected: proxying another machine's editor through this nit-gui (a reverse
proxy per instance, TLS and cookie questions for no gain), a single global pair
with a host prefix (still one machine's editor).

Cost: a value without a trailing slash is passed through as written; the Drop
manager keeps using the host-wide editor because its store is host-wide.

## 2026-11-15 — One publish path: bin/deploy, web only

Context: `bin/deploy [nixos|frankfurt]` with `bin/nixos` and `bin/frankfurt`
aliases from 2026-11-06. The service has been web-only for a while, and the two
targets made "deployed" ambiguous: a change landed on nixos while
`https://bongdo.space/nit/` still served the old build.

Decision: `bin/deploy` is the only publish command and always does the Frankfurt
path (web bundle with base `/nit/`, Go binary, app on `127.0.0.1:7791`, Caddy on
`:7792`, public at `https://bongdo.space/nit/`). `bin/nixos` and `bin/frankfurt`
are deleted. `bin/check` stays the only build and test command.

Why: one command, one URL, nothing to pick and get wrong.

Rejected: keeping the aliases as no-ops (they would keep two names for one
action and hide the break from habit-driven callers).

Cost: anything outside this repo that called `bin/frankfurt` or `bin/nixos`
must switch to `bin/deploy`; the NixOS host is no longer updated by this tree.

## 2026-11-15 — The bridge is the gate's agent, not a nit-gui transport

Context: a machine that runs OpenCode needs to be reachable from the house
without ssh, and the gate now owns authentication, routes and the public entry.

Decision: the bridge holds an outbound WebSocket to the gate at `/agent`, and the
gate exposes every machine target as an ordinary path `/i/<machine>/<target>/`.
nit-gui then stores a plain `url` instance pointing at
`http://127.0.0.1:8090/i/<machine>/opencode` with a signed service identity for
loopback requests. Events come over the same path as SSE.

Why: the gate already decides who may reach what, so one place owns the socket,
the token and the routing. nit-gui keeps no transport code and no machine
credentials, and a future app on the same machine is one more target rather than
a second integration.

Rejected: an `agent` transport inside nit-gui (two owners of the same socket,
machine tokens living in the app's config, and no way for other apps to use it);
an sshd tcp target as the only story (uses sshd as a proxy when we already have
one).

Cost: the gate grows a socket registry and a proxy that can fail mid-stream; a
loopback service identity has to be signed by both binaries from the same key.

## 2026-11-15 — The terminal lives inside the bridge

Context: a remote machine needs a shell, and a second binary on that machine is
exactly the dependency the setup tries to avoid.

Decision: the bridge hosts the terminal. term-gui's `pty`, `session` and `ws`
packages move into a shared module `termcore`; term-gui and the bridge both
import it, so the terminal behaviour is the same code, only a different owner.

Why: tmux, resize, reattach and scrollback already exist and are tested; copying
or reimplementing them inside the bridge would be a slower and worse terminal.

Rejected: term-gui on the machine (second binary, second updater); sshd through
the bridge plus a remote mode in term-gui (uses sshd as a PTY server and needs
the same amount of code in another place).

Cost: termcore is a shared module with its own version, and term-gui's SPA needs
a base path so the same bundle runs under `/i/<machine>/term/`.

## 2026-11-15 — Another machine's editor is one pero-gui over sshfs

Context: file chips from a nixos chat must open the editor, but the editor reads
a local filesystem.

Decision: mount the machine on the house over sshfs and point the existing
per-workspace pero-gui instance at that mount. No pero-gui on the machine.

Why: editing is a house-side activity; the mount gives real paths and real
permissions, and no new service is installed on the machine. A bridge `pero`
target stays available for the day a local editor on the machine is worth it.

Rejected: pero-gui on every machine (one more binary, its own updates, another
auth surface); a file-editing API in the bridge (a second editor protocol).

Cost: writes go through sshfs, so a slow or sleeping link makes saving slow; the
mount has to exist before the editor starts.

## 2026-11-15 — API calls get 401, browsers get a redirect

Context: the gate answered every anonymous request with a 303 to `/login`. A
fetch or an EventSource from nit-gui, or any server-side client, therefore
received an HTML login page as a successful response instead of an
authentication error.

Decision: an anonymous request that asks for JSON (`Accept: application/json`),
carries `X-Requested-With: XMLHttpRequest`, or targets `/i/` or `/api/` gets
`401` with a JSON body. Everything else keeps the redirect, so a browser typing
an address still lands on the login form. Separately, a request from loopback may
present a signed identity in `X-Gate-Identity`; the gate verifies it with the same
key as the session cookie, strips the header, and forwards a freshly signed
identity upstream.

Why: the two callers are simply different and pretending otherwise produces the
worst failure mode — a 200 that is a login page. The signed loopback identity lets
nit-gui talk to `/i/<machine>/...` without inventing a second credential.

Rejected: 401 for every anonymous request (breaks the login flow for humans); a
separate service password (a second secret to rotate for a client that already
runs as the same user on the same host).

Cost: loopback is trusted, so any local process can act as admin at the gate. That
is already true for the services themselves, but it must not become an excuse for
opening `/i/` to the network without a session.


## 2026-11-15 — gate pages wear the nit-gui stock theme

Context: the root page and the admin were a one-off dark palette with the orange
`#c4794f` as the primary colour, so every link, button and border competed with
it and the page read as an orange site.

Decision: the gate templates use the same tokens as nit-gui stock light/dark:
neutral `--primary`, `--accent` for surfaces, and `--success`/`--attention`/
`--danger` only as state colours. A toggle in the header switches light and dark,
remembers the choice in `localStorage`, and falls back to `prefers-color-scheme`.
Motion is short (0.3s rises, 0.18s hover) and disabled by `prefers-reduced-motion`.

Why: two front doors on the same host should not look like two products, and a
neutral primary leaves the accent free to mean "look here".

Rejected: a third palette of its own (more to maintain, no benefit); a theme
picker with all 14 nit-gui themes (the gate needs light and dark, not Gruvbox).

Cost: the gate CSS is a hand-written copy of the tokens, not an import from the
web app; changing the palette in nit-gui does not update the gate.

## 2026-11-15 — an unknown device gets a name, not "неизвестно"

Context: the admin showed every device as "неизвестно". Device names came only
from a User-Agent table with five browser tokens; anything else — curl, a Go
client, a session created before devices existed — fell through to a placeholder,
and those rows were indistinguishable from each other.

Decision: sessions without a device adopt one on their next authenticated
request, the name table now covers mobile browsers, Chromium-based brands and
common non-browser clients, an unrecognised User-Agent falls back to its product
token, and every row shows a short device id. A device with no User-Agent is the
only case that still says "неизвестное устройство".

Why: a list where every row is the same word cannot be used to revoke one
session, which is the only reason the list exists.

Rejected: one device per user (loses the ability to revoke a single session);
deduplicating by name and IP (two identical phones behind one NAT would share a
row, so revoking one would revoke both).

Cost: a browser that logs in again creates another row; the id column is the only
way to tell them apart until devices get a stable cookie.

## 2026-11-15 — the gate mints the app session cookie

Context: `/pero` and `/term` are served by their own binaries behind the nit-gui
auth gate. They do not accept the gate's signed `X-Gate-Identity`, so they answer
an authenticated request with a redirect to `/nit/auth`. That page is served by
nit-gui, which does accept the identity, so it redirects back to `/pero`. A
browser with a gate session but no `nit_gate` cookie bounced between the two until
Chromium gave up: `ERR_TOO_MANY_REDIRECTS`, which is exactly what a phone that
never logged into nit-gui saw.

Decision: on login, and on any authenticated request without a valid `nit_gate`
cookie, the gate sets that cookie itself. The token is the nit-gui
session format (HMAC-SHA256 over `v1.<expiry>` with a key derived from the shared
password hash), so the apps accept it and the loop ends after one redirect.

Why: the gate already holds the password hash and is the only front door; teaching
pero and term to trust the forwarded identity would mean touching two other
projects and their deploys.

Rejected: letting the loop stand and asking people to log in twice (it breaks the
phone); stripping `/nit/auth` from redirects at the gate (hides the real problem
and still leaves pero unauthenticated).

Cost: the gate now knows how to mint another app's cookie. Rotating the password
invalidates the minted cookie, and the gate mints a new one on the next request. The
cookie is issued to every authenticated user, not only admins.

## 2026-11-16 — вход: временная сессия, QR с телефона, TOTP

Контекст: один пароль открывает nit, pero, term, drop и админку, и он же —
единственный фактор. Телефон уже доверен на год, но вход на новом десктопе требует
набирать пароль, а вход с чужого компьютера оставляет сессию на неделю.

Решение: три независимые вещи. Галочка «не запоминать этот вход» (включена по
умолчанию, выбор запоминается в localStorage) ставит cookie сессии без срока и не
записывает устройство. QR-вход: десктоп показывает одноразовый тикет на 2 минуты,
телефон с живой сессией подтверждает, десктоп опрашивает статус и получает сессию;
тикет привязан к cookie того браузера, который его создал. TOTP на stdlib
(HMAC-SHA1, base32, окно ±30 с, защита от повтора по номеру шага), 8 кодов
восстановления, включение по текущему паролю, отключение по паролю и коду.

Почему: QR убирает набор пароля на новом устройстве, TOTP закрывает дыру
«украл пароль — вошёл везде», временная сессия стоит три строки и не мешает
остальным двум.

Что отвергли: декодер QR внутри страницы как зависимость — вместо него
`BarcodeDetector`, где он есть, и поле для вставки ссылки, где нет; шифрование
секретов TOTP — они лежат в том же файле, что и хеш пароля, модель угроз та же.

Цена: в `users.json` появились секреты TOTP и хеши кодов восстановления; потеря
телефона без кодов восстановления лечится только `go run ./cmd/gate reset-totp <имя>`; тикеты QR живут в
памяти, поэтому перезапуск гейта рвёт незавершённый вход.

## 2026-11-16 — вход по имени и коду, пароль стал запасным

Контекст: 2FA была вторым шагом после пароля. Пароль общий на все сервисы и
набирается каждый раз, а телефон с аутентификатором всегда под рукой — второй шаг
выглядел лишним, а первый фактор при этом ничего не добавлял к защите.

Решение: у аккаунта с включённой 2FA вход — имя и код из приложения (или код
восстановления) одним шагом. Пароль остаётся запасным путём для аккаунтов без 2FA,
для смены пароля и для отключения 2FA; поле спрятано за «войти по паролю».

Почему: один шаг вместо двух, код и так единственное, что реально проверяется;
украденный пароль без телефона больше ничего не открывает.

Что отвергли: пароль плюс код всегда (лишний шаг), отдельная страница ввода кода
(лишний клик и QR-вход пропадает с экрана, где он нужен).

Цена: шестизначный код стал единственной преградой для аккаунтов с 2FA, поэтому
добавлен счётчик неудач по имени (5 попыток — блок от минуты до 15) в дополнение
к блокировке по IP; аккаунт без 2FA по-прежнему входит по паролю.

## 2026-11-16 — Sidebar views can be hidden in Settings

Контекст: три вида списка (`This dir`, `All chats`, `Everywhere`) занимали строку
переключателя у каждого пользователя, хотя часть из них не нужна: без второго
инстанса `Everywhere` пуст, в одном проекте `All chats` лишний.

Решение: настройка `Chat views` хранит включённые виды в `nit-gui.scopes`, по
умолчанию все три. Выключенный вид исчезает из переключателя, из `Alt+←/→` и из
выбора рабочей папки; последний включённый выключить нельзя.

Почему: один список на переключатель и на клавиатуру, состояние в браузере —
настройка виду, а не сети.

Что отвергли: `Everywhere` только при подключённых инстансах (молча пропадает и
ломает привычное место) и серверную настройку (это вкус браузера, не машины).

Цена: если вид выключен, выбрать рабочую папку можно только в текущем виде;
включение обратно — Settings → Chat views.

## 2026-11-16 — Spelling marks are coloured words, not squiggles

Контекст: волнистое подчёркивание рисовалось вторым текстовым слоем поверх
textarea, и при прокрутке, переносе строки или диапазоне от LanguageTool с
пробелом по краю полоски уезжали от слова, а иногда висели в пустом месте.

Решение: проблемные слова и фразы окрашиваются в `--destructive`, смешанный с
`--foreground`; подчёркивание убрано, а у грамматических диапазонов обрезаются
пробелы по краям — и в отрисовке, и в замене по подсказке.

Почему: цвет не зависит от геометрии строки и переживает прокрутку; обрезка
заодно перестала съедать пробел при применении замены.

Что отвергли: сплошное подчёркивание (та же привязка к layout) и подсветку
фоном (в тёмной теме почти не видна, а на длинной фразе выглядит как выделение).

Цена: ошибка обозначена только цветом, формы у маркера нет; правка диапазона
сдвигает позиции грамматических подсказок, если LanguageTool считает иначе.

## 2026-11-16 — Settings: no footer, in-place pickers, no sign out

Контекст: внизу настроек стояли `Instances` и `Sign out`, и по привычке туда
жали, чтобы закрыть панель; все списки были нативными `<select>`, хотя у темы,
фона и инстансов уже есть свои меню с превью.

Решение: футер убран, `Instances` стала строкой в `Session defaults`; булевы
опции — переключатели, выборы — свой поповер или существующий пикер темы и фона;
кнопка `Sign out` из приложения убрана.

Почему: закрытие — по крестику, бэкдропу и `esc`, а не по случайной кнопке;
один вид контролов на всю панель; тема и фон показываются превью, а не текстом.

Что отвергли: оставить выход для общих устройств (выход есть на страницах гейта),
свой пикер для темы и фона (уже есть и умеет превью).

Цена: из приложения нельзя выйти; `POST /auth/logout` остаётся, но кнопки к нему
нет.

## 2026-11-16 — Spelling waits for the word, punctuation fixes itself

Контекст: пока слово набиралось, nspell успевал покрасить его префикс в красный
(`ситуац`), и метка исчезала на готовом слове; а очевидную вставку запятой от
LanguageTool приходилось применять руками, хотя подсказка была одна.

Решение: метка орфографии не рисуется, пока каретка стоит в конце слова без
разделителя; автоправка опечаток срабатывает на пробел, точку, запятую и перевод
строки, а грамматическая правка применяется сама, если она единственная и только
вставляет пунктуацию в конец набранного текста (отменяется Backspace).

Почему: префикс слова — не ошибка, а окончание ещё не набрано; вставка запятой
не меняет буквы, поэтому её можно применить без риска испортить текст.

Что отвергли: автоприменение любых грамматических замен (переставляют слова и
портят смысл), словарь префиксов для проверки «слово может продолжиться» (лишний
проход по 150k словоформ ради того же эффекта), правку пунктуации не в конце
текста (меняет уже прочитанное).

Цена: слово без пробела в конце сообщения не подсвечивается до отправки; одна
грамматическая правка на нажатие, чтобы каскад запятых не переписывал текст.
