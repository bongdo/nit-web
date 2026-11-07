# Companion: a personal Android chat app for documents and the home screen

Status: concept v2, decisions from 2026-11-07 review applied. Nothing built.
Target user: one person (the author's wife), Android only, not a developer.

## Locked decisions

| Decision | Value |
| --- | --- |
| Platform | Android only. No iOS, no web build. |
| Distribution | Sideloaded APK, personal use, no Play Store. |
| Accounts | None. No login, no server, no sync. |
| Key | The existing `opencode-go` key, embedded in the APK. |
| Transport | Phone talks to the gateway directly. Proven with curl: streaming works. |
| Voice | Dictation in. **No TTS, no voice mode.** |
| Storage | On the phone: IndexedDB for chats and blobs. |
| Design | The nit-gui default dark theme, mobile-first, not a generic messenger. |

The big consequence: **there is no backend**. The first draft had a Go server,
auth, Caddy and a VPS. All of that existed to hide a key and serve a browser. With
a personal APK the key can live inside the app, so the server, the login, the
hosting and the backup story all disappear. The app works offline for history and
only needs the network to answer.

## Direct gateway access (verified)

```
POST https://opencode.ai/inference/go/openai/v1/chat/completions
Authorization: Bearer <opencode-go key>
x-opencode-org-id: wrk_…
x-opencode-session: ses_<random per install>
{"model":"deepseek-v4.1-flash","stream":true,…}
```

OpenAI-compatible, SSE streaming, returns `reasoning_content` deltas as well as
`content`. Ignore the reasoning in the transcript, show it as a quiet "думает…"
line. A normal answer streams in under a second.

## Models, chosen automatically

| Input | Model | Why |
| --- | --- | --- |
| Text only | `deepseek-v4.1-flash` | Same model as the dev app. $0.15/$0.60 per Mtok. |
| Photo / screenshot | `deepseek-v4.1-flash` | It accepts images. Escalate to Argon only if quality disappoints. |
| PDF / scanned document | `gemini-4-argon` | Only cheap model in the gateway with native PDF plus strong layout reading. $2/$10. |
| Spreadsheet | `gemini-4-argon` after local conversion to tables | The model sees data, not a screenshot. |
| "Глубоко" (optional) | `gemini-4-argon` | Only for a hard page; hidden behind a long-press, no visible picker. |

No model picker in the UI. A 10-page PDF costs about one cent.

## Architecture on the phone

```
Capacitor Android shell (one APK)
  WebView: React 19 + Vite + Tailwind + shadcn primitives
    screens: chats · chat · document · overlay
    storage: IndexedDB (chats, messages, blobs, extracted text)
    gateway: fetch + SSE; fallback to a Kotlin OkHttp plugin if CORS bites
  Kotlin plugins:
    camera + ML Kit Document Scanner
    share intent receiver (ACTION_SEND, ACTION_PROCESS_TEXT)
    system speech recognition for dictation
    VoiceInteractionService + assist overlay
    notifications
```

If the WebView cannot call the gateway directly because of CORS, the same calls
move into a 150-line Kotlin plugin. Spike this first, before the UI work.

Data model in IndexedDB:

- `chats(id, title, created, updated, pinned)`
- `messages(id, chatId, role, text, attachments[], model, cost, created)`
- `docs(id, name, mime, size, pages, blobKey, textByPage[], created)`
- `search` — computed at query time over message text and extracted pages; a few
  thousand messages do not need an index.

## Design language (from nit-gui, not a generic chat UI)

The look comes from the existing default dark theme: near-black blue-grey ground,
hairlines, one amber accent, mono for metadata, no candy colours.

- Tokens copied from `web/src/index.css`: `--background oklch(0.165 0.008 260)`,
  `--card oklch(0.195 0.009 260)`, `--secondary oklch(0.245 0.01 260)`,
  `--border oklch(0.29 0.01 260)`, `--spark oklch(0.78 0.14 55)`, radius 10 px.
- Assistant messages are **not** bubbles: avatar dot, name, model and latency in
  mono, then plain markdown at 15 px / 28 px. User messages are a `secondary`
  bubble with a 4 px bottom-right corner, exactly like `MessageRow.tsx`.
- Metadata is uppercase mono 9–10 px with letter-spacing. Technical labels stay
  mono: `PDF · 12 СТР · 2,8 МБ`, `gemini · 6,2 с`, `СТР. 7`.
- One accent only: the spark amber, used for the active action, the citation chip,
  the lasso and the outline highlight. Everything else is greyscale.
- Hairline gradient sheen on the surfaces that just changed (header underline,
  sheet top edge, overlay top edge), 160 ms enter motion — the same trick as
  `chrome-sheen-*` in nit-gui. No bouncing, no confetti.
- Attachment rows are monochrome with a single amber row for the recommended
  action ("Сканировать документ"), file types in mono on the right.

## Screens

1. **Chat** — document bar under the header, transcript, composer. The answer ends
   with a citation chip; tapping it opens the page.
2. **Document** — the real page, pinch-zoom, the cited clause highlighted in
   amber, a small "?" marker, and a composer that asks about this page only.
3. **Capture** — bottom sheet: scan, camera, gallery, file, plus recent documents.
   The scanner is the recommended action, because it fixes the photo before the
   model ever sees it.
4. **Assist overlay** — screenshot of another app, freehand lasso or tap on a text
   block, actions (Перевести / Объяснить / Скопировать / Спросить), then the answer
   opens as a normal chat.

The mock is in `2026-11-07-mobile-companion.html`.

Tap-on-text is the quiet advantage over Circle to Search: `AssistStructure` gives
the actual text nodes, so tapping a number selects exactly that field instead of
pixels around it.

## Reading documents well

1. ML Kit Document Scanner: edge detection, perspective fix, multi-page PDF. This
   is the single biggest quality lever and it is free and on device.
2. Send the original file, no downscale, no re-encode. Strip EXIF location.
3. PDF goes to the model natively; no OCR step, no text extraction for the model.
4. `xlsx`/`csv` → one markdown table per sheet with values, formulas evaluated.
   `docx` → text plus embedded images.
5. Two-pass on dense pages: whole page first, then a 2× crop of the region the
   question is about when the answer depends on small print.
6. Cache extracted text per document hash, cite page numbers, quote verbatim. The
   page render is kept for the citation view.

## Phases

Part 1 (now): concept. Part 2: build with parallel subagents, one task per agent.

| Wave | Tasks | Why this order |
| --- | --- | --- |
| 0 | Repo scaffold, Capacitor, design tokens, storage, gateway client + streaming, CORS spike | Everything else imports these; must be one hand, not six. |
| 1 | Chat screen · composer and capture sheet · PDF import and page viewer · chat list and search · Android shell, share intent, camera and scanner | Independent once wave 0 exists; 5 agents in parallel. |
| 2 | Assistant role: `VoiceInteractionService`, screenshot, overlay UI, lasso, tap-on-text, hand-off to chat | Needs the Android shell from wave 1; one agent, device testing. |
| 3 | Polish: motion, empty and error states, dictation, notifications | After the flows exist. |

Acceptance for the whole thing: `bin/check` green, APK installed on the target
phone, and these five scenarios work — photo of a page with a citation; 10-page
PDF question; spreadsheet question; share from another app; long-press home over
another app, lasso, answer.

## Risks

- **The gateway may refuse WebView requests** (CORS or bot filtering). Mitigation:
  Kotlin HTTP plugin, same API. Spike in wave 0.
- **The key is extractable from the APK.** Accepted for personal use; rotate it if
  the APK ever leaves the family.
- **Assistant gesture on Samsung/Xiaomi** may be bound to the vendor assistant.
  Test on the actual phone before wave 2. Fallback: floating bubble plus
  MediaProjection consent, which is worse UX.
- **`FLAG_SECURE` apps** give a black screenshot. Unfixable.
- **Reasoning tokens** cost output money and add latency. Use the low variant if
  the gateway exposes it, and hide reasoning in the UI.
- **HEIC** from a gallery import needs conversion in the shell.
- **No backup by default**: Android auto-backup may skip large blobs. Export a chat
  to markdown is a cheap safety valve.

## Open questions

1. App name, and how the assistant introduces itself (her name in the system prompt?).
2. Chat list: drawer over the chat, or a full list as the first screen?
3. Documents: only inside chats, or also a separate library tab?
4. Web search from the app ("найди в интернете") — skip in v1?
5. Repo: new `~/Projects/companion`, copying files from nit-gui one way?
