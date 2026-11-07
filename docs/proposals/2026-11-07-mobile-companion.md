# Nita: a personal Android chat app for documents and the home screen

Working name: **Nita** (short, one word, no persona behind it; the label and icon
can change at any time without touching code).
Status: concept v4, decisions from the 2026-11-07 review applied. Nothing built.
Target user: one person (the author's wife), Android only, not a developer.

## Locked decisions

| Decision | Value |
| --- | --- |
| Platform | Android only. No iOS, no web build. |
| Distribution | Sideloaded APK, personal use, no Play Store. |
| Accounts | None. No login, no sync. |
| Key | The existing `opencode-go` key, embedded in the APK. |
| Transport | Phone talks to the inference gateway directly. Proven with curl. |
| Voice | No TTS, no in-app dictation. The system keyboard already types by voice. |
| Storage | On the phone: IndexedDB. Export by a button in settings, nothing automatic. |
| Themes | All 13 themes from nit-gui plus "system". |
| Design | The nit-gui default dark theme, mobile-first, not a generic messenger. |
| Chat list | A sheet that comes up from the bottom. No side drawer. |
| Persona | None. No name, no introductions, no character. |
| Overlay | No canned actions. The screenshot or region is attached; the user asks freely. |
| Modes | "Сценарии": a system prompt plus editable starter phrases. |

## Backend: gateway yes, OpenCode runtime no

Two different things are called "opencode", and only one of them is a backend.

1. **The inference gateway** — `https://opencode.ai/inference/go/openai/v1`.
   OpenAI-compatible, streams SSE, accepts images and PDFs, bills to the same
   `opencode-go` key the dev app already uses. This *is* the ready-made backend.
   Nita calls it directly; no server of ours in between.
2. **The OpenCode service** — the agent runtime on port 49374: sessions, agents,
   tools, shell execution, file writes, permissions, a workspace directory.
   Built for coding.

Using the runtime as Nita's backend would mean exposing an agent with shell access
to the internet for an app that ingests arbitrary PDFs and photos. One prompt
injection inside a scanned document becomes command execution on the box. It also
brings back auth, hosting, backups, a workspace per chat and a second failure
point, and model routing would be stuck behind a server. The only gains are
server-side history (a manual export covers it) and keeping the key out of the
APK (already accepted).

Decision: **app → gateway directly**. If server-side history or a second device
ever becomes a real need, add a thin Go proxy over the same gateway — never the
agent runtime.

"Works offline" is not a reason either way: both variants need the network to
answer. The difference is only where the key and the history live.

## Architecture on the phone

```
Capacitor Android shell (one APK)
  WebView: React 19 + Vite + Tailwind + shadcn primitives
    screens: chats sheet · chat · document · settings
    storage: IndexedDB (chats, messages, blobs, extracted text)
    gateway: fetch + SSE; fallback to a Kotlin OkHttp plugin if CORS bites
  Kotlin plugins:
    camera + ML Kit Document Scanner
    share intent receiver (ACTION_SEND, ACTION_PROCESS_TEXT)
    VoiceInteractionService + assist overlay
    notifications
    export/import through MediaStore (a file the user picks, nothing scheduled)
```

If the WebView cannot call the gateway directly because of CORS, the same calls
move into a 150-line Kotlin plugin. Spike this first, before the UI work.

Data model in IndexedDB:

- `chats(id, title, scenarioId, created, updated, pinned)`
- `messages(id, chatId, role, text, attachments[], model, cost, created)`
- `docs(id, name, mime, size, pages, blobKey, textByPage[], created)`
- `scenarios(id, name, prompt, starters[], builtin)`
- search is computed over message text and extracted pages; a few thousand
  messages do not need an index.

## Themes

All of them, ported as-is: Stock light, Stock dark, Nord, Solarized, Gruvbox,
Dracula, Paper, Paper Dark, Ember, Kiln, Mist, Ash, Ash Dark, plus "system".
The picker is a two-column grid; every tile previews itself in its own colours
with the `Aa` sample, the label and the accent dots, exactly like
`ThemePicker.tsx`. Changing a theme is instant and repaints the status bar and
navigation bar too.

Light themes need one extra pass: the composer, the masks and the markdown were
designed on dark. Check Paper, Mist and Solarized when the mobile layout exists.

## Scenarios

A scenario is data, not a code path: `{name, prompt, starters[]}`. The chosen
scenario is stored on the chat, prepended to every request, and shown in the
header (`Турецкий · репетитор · уровень A2`). Changing it is a menu action.

Every scenario is layered on one base rule: answer short, no name, no
introductions, no persona.

| Scenario | Prompt does | Starter chips |
| --- | --- | --- |
| Просто | Plain assistant, answers the question, no lecturing. | none |
| Турецкий | Patient tutor: shows the corrected sentence, explains each change in one line, offers the next exercise. | Исправь · Переведи · Объясни правило |
| Документы | Answers only from the attachment, quotes verbatim, names the page. | О чём это? · Что важно? · Переведи |
| Свой | The user writes a prompt once and names it. Covers other languages. | three phrases the user chooses |

Starter chips insert text into the composer; they never fire a request. The user
can edit the phrase before sending, or ignore the chips entirely.

Citations are not a scenario feature. Any request that carries a PDF or a scan
gets the document instructions appended automatically, so a contract question in
"Просто" still ends with a page chip.

## History and backup

The live store is IndexedDB on the phone. Nothing runs on a schedule.

- **Экспорт** in settings writes one zip to a folder the user picks: `chats.json`,
  `scenarios.json` and the original files.
- **Импорт** reads the same zip back. This is the move-to-a-new-phone path.
- Android auto-backup of the app data stays on (it is the OS, not the app).
- "Поделиться чатом" saves a single conversation as markdown.

Uninstalling without an export loses the documents. The app says so once, on the
export screen, not in a popup.

## Design language (from nit-gui, not a generic chat UI)

- Tokens copied from `web/src/index.css`, including every `[data-theme]` block.
- Assistant messages are **not** bubbles: avatar dot, name, model and latency in
  mono, then plain markdown. User messages are a `secondary` bubble with a 4 px
  bottom-right corner, exactly like `MessageRow.tsx`.
- Metadata is uppercase mono 9–10 px with letter-spacing: `РЕПЕТИТОР · УРОВЕНЬ A2`,
  `deepseek · 1,4 с`, `СТР. 7`.
- One accent only: spark amber for the active action, the citation chip, the lasso
  and the page highlight. Everything else is greyscale.
- Hairline gradient sheen on the surfaces that just changed, 160 ms enter motion.
- Attachment rows are monochrome, one amber row for the recommended action.
- No microphone button anywhere: dictation belongs to the keyboard.

## Screens

1. **Chat** — header with the scenario and a chevron, transcript, starter chips,
   composer. Tapping the title pulls the chats sheet up from the bottom.
2. **Chats sheet** — 78% height, grabber, search over chats and documents, rows
   with a snippet and a document badge, the current chat marked with an amber bar,
   "+" for a new chat. Drag up for full height, drag down or tap outside to close.
3. **Document** — the real page, pinch-zoom, the cited clause highlighted in
   amber, a composer that asks about this page only.
4. **Capture** — bottom sheet: Документ (scan), Фото (camera), Из галереи, Файл.
   Recent documents below.
5. **Settings** — theme grid, scenarios, export/import, about. One screen.
6. **Assist overlay** — screenshot of another app, optional freehand lasso, the
   crop and the screen text attached, one free-form input.

The mock is in `2026-11-07-mobile-companion.html`.

## Документ vs Фото

They open different cameras and produce different files:

- **Документ** uses ML Kit Document Scanner: finds the page edges, fixes
  perspective, lets you add pages, outputs one multi-page PDF. For contracts,
  test results, receipts, textbook pages. The single biggest accuracy win,
  because the model never sees a crooked photo.
- **Фото** is the ordinary camera: one JPEG, no processing. For a whiteboard, a
  label, a plant, a child's drawing, a menu.

The old wording made them sound like the same thing. The fix is naming by outcome,
not by device, plus one line of hint under each.

## Assist overlay without canned actions

The gesture gives us three things: a screenshot, the text structure of the screen,
and the source app. All three are attached to the context. The overlay shows the
screenshot dimmed with a lasso, a chip "Фрагмент экрана · 240 × 120 · текст
приложен", and one input: "Спросите что угодно…".

- Drag to narrow the region, or ask about the whole screen.
- An empty send attaches the screen and asks "Что это?" implicitly.
- The answer opens as a normal chat, named after the source app, so it can be
  continued, saved or exported like any other conversation.
- No "Перевести / Объяснить / Копировать" buttons. The user says what they want.

Tap-on-text is the quiet advantage over Circle to Search: `AssistStructure` gives
the actual text nodes, so tapping a number selects exactly that field instead of
pixels around it.

## Reading documents well

1. ML Kit Document Scanner: edge detection, perspective fix, multi-page PDF.
2. Send the original file, no downscale, no re-encode. Strip EXIF location.
3. PDF goes to the model natively; no OCR step.
4. `xlsx`/`csv` → one markdown table per sheet, formulas evaluated. `docx` → text
   plus embedded images.
5. Two-pass on dense pages: whole page first, then a 2× crop of the region the
   question is about.
6. Cache extracted text per document hash, cite page numbers, quote verbatim.

## Models, chosen automatically

| Input | Model | Why |
| --- | --- | --- |
| Text only | `deepseek-v4.1-flash` | Same model as the dev app. $0.15/$0.60 per Mtok. |
| Photo / screenshot | `deepseek-v4.1-flash` | It accepts images. Escalate only if quality disappoints. |
| PDF / scan | `gemini-4-argon` | Only model in the gateway with native PDF and strong layout reading. $2/$10. |
| Spreadsheet | `gemini-4-argon` after local conversion | The model sees data, not a screenshot. |

No model picker. A 10-page PDF costs about one cent.

## Phases

Part 1 (now): concept. Part 2: build with parallel subagents, one task per agent.

| Wave | Tasks | Why this order |
| --- | --- | --- |
| 0 | Repo scaffold, Capacitor, design tokens and all 13 themes, IndexedDB, gateway client + streaming, CORS spike | Everything else imports these; must be one hand, not six. |
| 1 | Chat screen and scenarios · chats bottom sheet and search · composer and capture sheet · PDF import and page viewer · settings, export/import · Android shell, share intent, camera and scanner | Independent once wave 0 exists; 6 agents in parallel. |
| 2 | Assistant role: `VoiceInteractionService`, screenshot, overlay, lasso, tap-on-text, hand-off to chat | Needs the Android shell from wave 1; one agent, device testing. |
| 3 | Polish: motion, empty and error states, notifications, light-theme contrast | After the flows exist. |

Acceptance for the whole thing: `bin/check` green, APK installed on the target
phone, and these six scenarios work — photo of a page with a citation; 10-page
PDF question; spreadsheet question; share from another app; long-press home over
another app, lasso, free-form question; export and restore on a clean install.

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
- **Light themes** need contrast fixes on the composer and the overlay.

## Open questions

1. Other languages besides Turkish — one custom scenario per language, or a
   language field inside a single "Языки" scenario?
2. A saved vocabulary (bookmark a word, list of words) — v1 or later?
3. Confirm the direct-to-gateway choice above; if server-side history is wanted
   anyway, it will be a thin proxy, not OpenCode.
