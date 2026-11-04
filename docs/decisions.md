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
