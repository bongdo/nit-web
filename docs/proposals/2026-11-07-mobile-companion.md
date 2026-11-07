# Companion: a personal Android chat app for documents and the home screen

Status: concept v3, decisions from the 2026-11-07 review applied. Nothing built.
Target user: one person (the author's wife), Android only, not a developer.

## Locked decisions

| Decision | Value |
| --- | --- |
| Platform | Android only. No iOS, no web build. |
| Distribution | Sideloaded APK, personal use, no Play Store. |
| Accounts | None. No login, no server, no sync. |
| Key | The existing `opencode-go` key, embedded in the APK. |
| Transport | Phone talks to the gateway directly. Proven with curl: streaming works. |
| Voice | No TTS, no in-app dictation. The system keyboard already types by voice. |
| Storage | On the phone: IndexedDB, plus export and import the user owns. |
| Themes | All 13 themes from nit-gui plus "system". |
| Design | The nit-gui default dark theme, mobile-first, not a generic messenger. |
| Overlay | No canned actions. The screenshot or selected region is attached; the user asks in their own words. |
| Modes | "Сценарии": a system prompt plus editable starter phrases. |

The big consequence: **there is no backend**. The first draft had a Go server,
auth, Caddy and a VPS. All of that existed to hide a key and serve a browser. With
a personal APK the key can live inside the app, so the server, the login, the
hosting and the backup story all disappear.

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

## Architecture on the phone

```
Capacitor Android shell (one APK)
  WebView: React 19 + Vite + Tailwind + shadcn primitives
    screens: chats · chat · document · settings
    storage: IndexedDB (chats, messages, blobs, extracted text)
    gateway: fetch + SSE; fallback to a Kotlin OkHttp plugin if CORS bites
  Kotlin plugins:
    camera + ML Kit Document Scanner
    share intent receiver (ACTION_SEND, ACTION_PROCESS_TEXT)
    VoiceInteractionService + assist overlay
    notifications
    export/import to Downloads (MediaStore) and daily text snapshot
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
with the `Aa` sample, the label and the primary/spark dots, exactly like
`ThemePicker.tsx`. Changing a theme is instant and repaints the status bar and
navigation bar too.

Light themes need one extra pass: the composer, the mask and the syntax of the
markdown were designed on dark. Check contrast on Paper, Mist and Solarized when
the mobile layout exists.

## Scenarios

A scenario is data, not a code path: `{name, prompt, starters[]}`. The chosen
scenario is stored on the chat, prepended to every request, and shown in the
header (`Турецкий · репетитор · уровень A2`). Changing it is a menu action, not a
new screen.

Built in:

| Scenario | Prompt does | Starter chips |
| --- | --- | --- |
| Просто | Plain assistant, short answers, no lecturing. | none |
| Турецкий | Patient tutor: corrects the sentence, shows the fixed line, explains each change in one line, offers the next exercise. | Исправь · Переведи · Объясни правило |
| Документы | Answers only from the attachment, quotes verbatim, names the page. | О чём это? · Что важно? · Переведи |
| Свой | The user writes a prompt once and names it. Covers other languages. | three phrases the user chooses |

Starter chips insert text into the composer; they never fire a request. The user
can edit the phrase before sending, or ignore the chips entirely.

Citations are not a scenario feature. Any request that carries a PDF or a scan
gets the document instructions appended automatically, so a contract question in
"Просто" still ends with a page chip.

## History and backup

The live store is IndexedDB on the phone. A few thousand chats with documents is
a few hundred megabytes; that is fine.

Durability, in three layers:

1. Android auto-backup of the app data (chat text). On by default.
2. **Daily snapshot** of chats and messages as one JSON file into
   `Downloads/Companion/`, last 7 kept. Written through MediaStore, no permission
   prompt, survives uninstall, lands in Google Drive if the phone backs up
   Downloads. Attachments are not included, only their names and metadata.
3. **Export / import** in settings: a zip with `chats.json`, `scenarios.json` and
   the original files. This is the real backup and the way to move to a new phone.

Uninstalling without an export loses the documents; the app says so once, in the
export screen, not in a popup.

## Design language (from nit-gui, not a generic chat UI)

The look comes from the existing default dark theme: near-black blue-grey ground,
hairlines, one amber accent, mono for metadata, no candy colours.

- Tokens copied from `web/src/index.css`, including every `[data-theme]` block.
- Assistant messages are **not** bubbles: avatar dot, name, model and latency in
  mono, then plain markdown. User messages are a `secondary` bubble with a 4 px
  bottom-right corner, exactly like `MessageRow.tsx`.
- Metadata is uppercase mono 9–10 px with letter-spacing: `РЕПЕТИТОР · УРОВЕНЬ A2`,
  `deepseek · 1,4 с`, `СТР. 7`.
- One accent only: spark amber for the active action, the citation chip, the
  lasso and the page highlight. Everything else is greyscale.
- Hairline gradient sheen on the surfaces that just changed (header underline,
  sheet top edge, overlay top edge), 160 ms enter motion. No bouncing.
- Attachment rows are monochrome, one amber row for the recommended action, file
  types in mono on the right.
- No microphone button anywhere: dictation belongs to the keyboard.

## Screens

1. **Chat** — header with the scenario, transcript, starter chips, composer.
2. **Document** — the real page, pinch-zoom, the cited clause highlighted in
   amber, a composer that asks about this page only.
3. **Capture** — bottom sheet with four outcomes: Документ (scan), Фото (camera),
   Из галереи, Файл. Recent documents below.
4. **Settings** — theme grid, scenarios, export/import, about. One screen, no
   submenus.
5. **Assist overlay** — screenshot of another app, optional freehand lasso, the
   crop and the screen text attached, one free-form input. No action buttons.

The mock is in `2026-11-07-mobile-companion.html`.

## Документ vs Фото

They open different cameras and produce different files:

- **Документ** uses ML Kit Document Scanner: finds the page edges, fixes
  perspective, lets you add pages, outputs one multi-page PDF. For contracts,
  test results, receipts, textbook pages. This is the single biggest accuracy win,
  because the model never sees a crooked photo.
- **Фото** is the ordinary camera: one JPEG, no processing. For a whiteboard, a
  label, a plant, a child's drawing, a menu.

The old wording ("Сканировать документ" next to "Камера") made them sound like the
same thing. The fix is naming by outcome, not by device, plus one line of hint
under each.

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
| 1 | Chat screen and scenarios · composer and capture sheet · PDF import and page viewer · chat list, search, settings, export/import · Android shell, share intent, camera and scanner | Independent once wave 0 exists; 5 agents in parallel. |
| 2 | Assistant role: `VoiceInteractionService`, screenshot, overlay, lasso, tap-on-text, hand-off to chat | Needs the Android shell from wave 1; one agent, device testing. |
| 3 | Polish: motion, empty and error states, notifications, daily snapshot | After the flows exist. |

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
- **Light themes** will need contrast fixes on the composer and the overlay.
- **Auto-backup writes to Downloads**: a plaintext copy of the conversations lives
  outside the app sandbox. Acceptable for this user; say it once in settings.

## Open questions

1. App name, and whether the assistant should address her by name.
2. Other languages besides Turkish — do we need a language setting in the
   scenario, or one custom scenario per language?
3. A saved vocabulary (bookmark a word, list of words) — v1 or later?
4. Daily snapshot into `Downloads/Companion/` — yes, or manual export only?
5. Chat list: drawer over the chat, or a full list as the first screen?
