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
