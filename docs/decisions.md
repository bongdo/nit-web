# Decisions

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
