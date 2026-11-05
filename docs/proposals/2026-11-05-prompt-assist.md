# Prompt assist: RU/EN proofreading and ghost completion

## Problem

The composer is the slowest part of working with a coding agent. Prompts are
written in Russian, English, or both, with typos, missing commas and code
identifiers mixed into prose. Users also repeat phrases from earlier prompts.
The GUI already has dictation, slash commands and attachments; it has no
correction and no completion.

Two features, one integration point:

- **Proofread** a draft before sending, without changing code, paths or names.
- **Ghost-complete** the draft after a pause; `Tab` accepts, `Esc` dismisses.

## What exists

### Correction

| Option | RU | EN | Offline | Weight | Quality | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| OpenCode `POST /api/experimental/generate/text` | yes | yes | no | none | context-aware, preserves code | best fit |
| LanguageTool self-hosted | 892 rules | 6074 rules | yes | Java 17, ~1.5 GB disk, 512 MB heap | spelling + grammar, no LLM | heavy but solid |
| LanguageTool public API | yes | yes | no | none | same rules | 20 req/min, text leaves machine |
| `nspell` + Hunspell `ru`/`en` | yes | yes | yes | ~4 MB dictionaries | typos only | cheap baseline |
| Harper.js | no | yes | yes | ~95 MB wasm | strong EN grammar | EN-only, too heavy |
| Yandex Speller API | yes | yes | no | none | excellent RU typos | cloud, typos only |
| Chrome Proofreader API | unclear | yes | yes | 22 GB free disk, 4 GB VRAM | trial, English-oriented | not a core path |

LanguageTool's Russian module is real but modest: 892 XML rules and 20 Java
rules, with spell checking. English has 6074 XML rules. The standalone server
needs Java 17 and roughly 1.5 GB on disk; the Docker image runs with a 256–512
MB heap. Its `/v2/check` response has offsets, replacements and rule ids, which
is exactly what inline underlines need.

OpenCode already exposes a stateless text generation endpoint:
`POST /api/experimental/generate/text` with `{prompt, model?}` returns
`{data: {text}}`. It uses the configured provider credentials, stores nothing,
and needs no new runtime. A local test with `opencode-go/claude-haiku-5-5`
gave 0.76–1.44 s for a one-sentence fix or continuation; `glm-5.3-flash` took
1.34 s, `deepseek-v4.1-flash` 7.2 s. Free models hit `Free usage limit
reached`. So the assist model must be selectable, and the UI must not assume
the chat model is fast.

### Ghost completion

| Option | Offline | Cost | Latency | Setup | Notes |
| --- | --- | --- | --- | --- | --- |
| Prompt history / snippets | yes | 0 | instant | none | repeats only |
| OpenCode generate | no | per call | ~1 s | none | bilingual, new text |
| Ollama / llama.cpp | yes | 0 | 0.3–1 s | model 0.5–1.5 GB | quality varies, RU weaker |
| Chrome Prompt API | yes | 0 | fast after load | Chrome + 2–4 GB model | not portable |
| `react-ghost-text` | n/a | n/a | n/a | 37 KB | contentEditable, not our textarea |
| CopilotTextarea | no | cloud | n/a | large framework | wrong shape |

Ollama supports a `suffix` field for fill-in-the-middle models; llama.cpp has
`/infill` and prompt caching. Both are good local providers if the user already
runs one. They are not worth bundling: this host has neither installed, and a
0.5–1.5 GB model download is a bigger commitment than the feature.

`react-ghost-text` is a small MIT component, but its controlled value is an
HTML string and it uses a contentEditable-style textbox. Replacing the existing
textarea would break attachments, dictation, slash commands, IME and styling.
A mirror overlay over the current textarea is smaller and safer.

## Three packages

### A. No model, one evening

- `spellCheck` on the textarea.
- Ghost completion from the prompts already sent in this workspace: prefix
  match, fuzzy initials, `Tab` accepts the remainder, `Esc` dismisses.
- A short RU/EN phrasebook of common prompt starts.

Zero dependencies, zero privacy risk, instant. Does not fix grammar and cannot
invent a new continuation.

### B. OpenCode-backed, recommended

- One backend route `POST /api/assist` for both modes.
- `proofread`: on-demand button and `mod+.`, diff before applying.
- `complete`: debounced ghost text, `Tab`/`Esc`, opt-in.
- Model picker in Settings; default is the session model, with a hint to choose
  a fast one.
- History ghost from package A stays as the instant fallback.

No new dependency, no second engine, no local model. Reuses the provider the
user already trusts for chat. The draft is sent before the user presses Send,
so the feature is off by default and documented.

### C. Fully local

- LanguageTool sidecar for RU/EN spelling and grammar with underlines.
- Ollama or llama.cpp for ghost completion.
- `NIT_GUI_LANGUAGETOOL_URL` and `NIT_GUI_COMPLETION_URL` point at them; if
  absent, the feature hides itself the same way dictation hides without
  `whisper-cli`.

Privacy and zero marginal cost, at the price of Java, a model download, two
health checks and more failure modes. Only worth it if offline is a hard
requirement.

## Smallest complete change for package B

### Backend

Add `POST /api/assist`:

```json
{ "mode": "complete" | "proofread", "text": "...", "model": { "providerID": "...", "id": "..." } }
```

- Validate `mode`, `text` length 1..8000, and the model reference; reject the
  rest with 400.
- Build a fixed prompt for the mode and call
  `/api/experimental/generate/text` through the existing `opencode.Client`.
- 12 s timeout. Return `{ "text": "..." }`; map upstream errors to 503 without
  leaking the password.
- For `complete`, the browser sends only the last ~600 characters. For
  `proofread`, the whole draft.

Prompt for proofread: fix spelling, grammar and punctuation; keep code, paths,
names, markdown and meaning; do not paraphrase; return only the corrected text.

Prompt for complete: continue the draft in the same language with 2–8 words;
return only the continuation, no quotes, no explanation; return nothing if
unsure.

### Frontend

- `api.assist(mode, text, model)`.
- `useAssist` hook: 700 ms debounce, minimum 12 characters, caret at the end,
  no selection, no IME composition, no slash palette, one request in flight,
  abort stale requests, cache the last 50 answers, back off for 60 s after an
  error.
- Ghost overlay: an `aria-hidden` mirror div with the same font, padding and
  width as the textarea, transparent text, and a muted suggestion span. Sync
  `scrollTop`; `pointer-events: none`. `Tab` accepts only while a suggestion is
  visible; `Esc` dismisses. An `aria-live` line says the suggestion exists.
- `Fix` button (Sparkles icon) and `mod+.`: run proofread, show a word-level
  diff in a panel above the composer, then `Apply` or `Dismiss`. Never rewrite
  silently.
- Settings: `Prompt assist` off/on, `Assist model`, `Ghost completion` on/off.
  Persist in `localStorage`.
- Disable ghost while dictating, uploading, submitting, streaming or inside a
  fenced code block. A helper `inFence(text, caret)` covers the last case.

### Post-processing

- Trim, strip wrapping quotes and backticks, cut at the first newline, cap at
  80 characters, reject a suggestion that repeats the tail of the draft or
  starts with the draft itself, reject more than three sentences.
- Join with a space unless the draft ends with whitespace or the suggestion
  starts with punctuation.

### Tests

- Go: `/api/assist` validates input, forwards the right path and body, maps
  upstream errors, and does not leak the password.
- Frontend: prompt builder, suggestion post-processing, `inFence`, and the
  diff helper with RU and EN fixtures.
- Manual: RU typo fix, EN typo fix, mixed text with `bin/check` and
  `Composer.tsx`; ghost appears after a pause, `Tab` accepts, `Esc` dismisses,
  typing cancels; off means no network requests; dictation shows no ghost.

## Acceptance check

1. `bin/check` is green.
2. With assist off, typing makes no `/api/assist` requests.
3. A Russian draft with three errors gets a diff; `Apply` changes only those
   words; code, paths and names stay byte-identical.
4. An English draft gets the same treatment.
5. After a pause, a ghost continuation appears. `Tab` inserts it; `Esc` hides
   it; typing another character replaces or cancels it.
6. A slow or failed model never blocks sending; errors are silent for ghost and
   visible only for the explicit `Fix` action.

## Risks

- `/api/experimental/generate/text` is experimental. Keep it behind one client
  method and hide the feature on 404/422.
- A one-second ghost may feel late. The history fallback covers the instant
  case; the setting lets the user turn the model path off.
- Suggestions cost money and send the draft to the provider. Use a dedicated
  fast model, debounce, cache, and an explicit off switch.
- The model may rewrite more than typos. The diff makes that visible before it
  reaches the textarea.
- The overlay can drift from the textarea after font or theme changes. Test at
  900 px and 1280 px, dark and light, and keep the mirror styles in one place.
- `Tab` and `Esc` already have jobs. Intercept them only while a suggestion is
  visible, and let the existing palette and double-`Esc` behavior win otherwise.

## Rejected for now

- LanguageTool sidecar: 1.5 GB of Java for a feature that an existing model can
  do; add it later only if inline underlines become a requirement.
- Harper: English only and 95 MB of wasm for half the problem.
- `nspell` underlines: typos only, and the underline overlay is most of the
  work anyway.
- Chrome Proofreader: English-oriented trial, hardware and browser limits.
- Yandex Speller and LanguageTool cloud: the draft leaves the machine for a
  typos-only result.
- CodeMirror or Monaco: inline completion is mature there, but migrating the
  composer breaks more than it fixes.
- `react-ghost-text` and CopilotTextarea: contentEditable or a framework, not
  the current textarea.

## Open questions

- Is a ~1 s ghost useful, or should model completion stay behind a hotkey and
  history completion be the only automatic one?
- Should `Fix` be on demand only, or also offered as "fix and send"?
- Is sending an unsent draft to the same provider acceptable when the feature is
  on? If not, package C is the only option.
