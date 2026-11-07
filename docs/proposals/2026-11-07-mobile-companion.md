# Companion: a mobile chat app for documents and the home screen

Status: proposal, nothing built.
Target user: one person (the author's wife), Android or iPhone, not a developer.

## Short version

Build a new, small product next to nit-gui, not a mode inside it. Reuse nit-gui's
frontend craft (markdown, streaming, attachments, themes, STT/TTS) and none of its
backend: OpenCode is a coding agent with tools and permissions, and it is the wrong
engine for a personal assistant.

The four pieces that matter, in order of value per day of work:

1. Mobile-first chat with excellent document capture (camera scan, PDF, photos,
   tables) — one week.
2. Native Android shell: share sheet, document scanner, notifications, voice —
   another week.
3. Android assistant role: the same gesture that opens Gemini, but our overlay,
   with the system screenshot and a lasso. Two weeks, highest wow, highest risk.
4. iOS shell: share extension plus iOS 26 Visual Intelligence intent. No overlay,
   no assistant role.

Real "circle to search" is Google's system feature. A third-party app can bind the
**assistant gesture** and receive the **screenshot** through the official Assist API
(`VoiceInteractionSession.onHandleScreenshot`). That is the honest, working version.

## Why not just put a new face on nit-gui

| Reuse | Rewrite |
| --- | --- |
| Markdown renderer, GFM tables, code copy, sandboxed HTML preview | Backend: no OpenCode, no sessions, no tools, no permissions |
| SSE stream accumulation and reconnect logic | Layout: full-screen chat, bottom sheet, safe areas, thumbs |
| Attachment picking, PDF/image cards, drag-drop | Chat storage: SQLite, not OpenCode sessions |
| Themes, density, scroll-to-bottom, swipe | Model layer: one provider, explicit vision/PDF handling |
| STT client and TTS server paths | Settings: none visible, one default model plus "Deep" |
| Password hashing (`internal/auth`) and cookie auth | Assistant/overlay module, Android Kotlin |

Rule: copy the files, do not share a package. Two products, one-way copying.
Forks drift; a shared library would force two products to ship together.

## What the phone actually allows (2026)

| Capability | Android | iOS 26 |
| --- | --- | --- |
| Be the default assistant, open on the system gesture | Yes: `ROLE_ASSISTANT` + `VoiceInteractionService` | No |
| Get the current screen text and a screenshot | Yes: `onHandleAssist`, `onHandleScreenshot` (user enables screen context) | No |
| Draw over other apps | Yes: assist session UI, or `SYSTEM_ALERT_WINDOW` bubble | No |
| Share a photo/PDF/text from any app into ours | Yes: `ACTION_SEND` | Yes: Share Extension |
| Act on selected text | Yes: `ACTION_PROCESS_TEXT` | Share/Action extension |
| Camera, document scan with edge detection | Yes: ML Kit Document Scanner (free, on device) | Yes: VisionKit |
| Push notifications | Yes: FCM | Yes: APNs (installed PWA also works) |
| System visual lookup | — | Yes, iOS 26 Visual Intelligence via App Intents: our app receives the capture and returns results |
| Install without a store | APK | Ad-hoc/TestFlight; free signing expires weekly |

Samsung, Xiaomi, Pixel and stock Android all expose "default assistant" in settings,
but the gesture differs (long-press home handle, side key, power button). Verify on
the actual phone before promising anything.

## Reading documents well

The current nit-gui already forwards images and PDFs; the quality gap is not in the
GUI. The wins, in order:

1. **Capture.** ML Kit Document Scanner rectifies edges, fixes perspective and makes
   a clean multi-page PDF. A crooked phone photo of a page loses more accuracy than
   any model upgrade gains.
2. **No client downscale.** Upload the original (up to the model's limit: Gemini
   tiles at ~3072 px, Claude resizes to 1568 px long edge). Strip EXIF location,
   keep orientation.
3. **Native PDF input.** Send the PDF to Gemini 4 / 3.8 Flash (up to 1000 pages,
   ~258 tokens per page) instead of OCR + text. Layout, tables and stamps survive.
4. **Spreadsheets as data.** `xlsx`/`ods` → one CSV/markdown table per sheet with
   formulas evaluated. A screenshot of a table is always worse than the table.
5. **Two-pass for dense pages.** First ask over the whole page for context, then
   if the answer depends on small print, re-ask over a 2× crop of that region and
   keep both. Store the page render so the answer can cite it.
6. **Document memory.** Cache the extracted representation per content hash. Follow-up
   questions are cheap, consistent and fast; re-extraction only when the file changes.
7. **Citations.** Answers quote verbatim and name page/sheet. The UI shows a page
   thumbnail chip; tapping opens the page full screen, pinch-zoom. This is what makes
   it feel trustworthy for contracts, prescriptions and recipes.

Models available here: `opencode/gemini-3.8-flash` ($1.5/$7.5 per Mtok) as the
default, `gemini-4-argon` or `claude-sonnet-5-5` for the "Deep" toggle. A 10-page
PDF is roughly 3k input tokens; normal family use lands at a few dollars a month.

## Architecture

```
phone (Capacitor shell)
  chat UI (React, copied from nit-gui)
  camera · ML Kit scanner · share intent · mic · notifications
        │ HTTPS
        ▼
companion (Go, one binary, on frankfurt behind Caddy)
  auth (single user, cookie, pbkdf2)
  chats + messages (SQLite, FTS5 for search)
  files (content-addressed on disk, page renders)
  model adapter (Gemini; streaming SSE)
        │
        ▼
model API
```

No OpenCode, no agents, no tool permissions. The only tools are: read a document,
search the web (optional), and answer.

Schema, minimal:

- `chats(id, title, created_at, updated_at)`
- `messages(id, chat_id, role, text, attachments_json, created_at)`
- `documents(id, sha256, name, mime, pages, path, text_cache, created_at)`

Attachments are served only to the authenticated session. Nightly `rsync` of the
state directory to the backup host; SQLite in WAL mode with `VACUUM INTO` for a
consistent snapshot.

## UX

1. **Open into the last chat**, not a list. Chats live in a drawer and a search field.
2. **One composer.** "+" opens a sheet: Camera, Scan document, Photo, File. Hold the
   mic to talk; release to transcribe into the text box, not to send.
3. **Long-press any message**: copy, read aloud, translate, "explain simpler".
   Long-press is the gesture people already have from WhatsApp and Telegram.
4. **Documents are objects, not bubbles.** A header card with name, pages and a
   page strip; questions continue on the same document without re-uploading.
5. **Assist overlay**: lasso or tap a region, then either ask a typed question in a
   tiny composer or pick an action (translate, explain, copy). The result opens in a
   normal chat so it can be continued.
6. **Voice mode**: full-screen orb, hands-free loop with barge-in, TTS on. This is the
   feature that makes it feel like an assistant rather than a chat app.
7. **Big type** (17–18 px base, 1.6 line height), dark by default, safe-area insets,
   44 px targets, everything within thumb reach. Streaming with a visible Stop;
   regenerate and edit-last always one tap away.
8. **No settings maze.** One model, one "Deep" toggle for hard documents, language
   auto. Every extra switch is a support call from a non-technical user.

## Phases

| # | Scope | Days | Acceptance |
| --- | --- | --- | --- |
| 0 | New repo, Go server, SQLite, auth, Gemini streaming, mobile web UI, PWA install | 3–4 | Photo of a page → answer with page citation on a phone screen |
| 1 | Capacitor Android shell: camera, ML Kit scan, share intent, notifications, recording | 4–5 | Share a PDF from WhatsApp into the app; scan a 3-page contract; answer arrives with a notification |
| 2 | Assistant role: `VoiceInteractionService`, screenshot, lasso, overlay, small composer | 8–12 | Long-press home on the target phone → overlay over another app → ask about a region → answer |
| 3 | Voice mode with TTS and barge-in; search over chats and documents | 3–4 | Hands-free: ask, hear the answer, interrupt, ask again |
| 4 | iOS shell: share extension, App Intents, Visual Intelligence | 3–5 | Share a screenshot from Photos and from the system Visual Intelligence |

Phase 2 is the only one that can fail for reasons outside the code: OEM gesture
mapping, a locked bootloader, or a vendor that ignores `ROLE_ASSISTANT`.

## Risks

- **Assistant gesture on non-Pixel phones** can be buried or bound to a vendor
  assistant. Test on the actual device first; if it fails, the floating bubble
  (`SYSTEM_ALERT_WINDOW`) is the fallback, but its screenshots need MediaProjection
  consent every session.
- **`FLAG_SECURE` apps** (banking, some messengers) return a black screenshot. Accept it.
- **Play Store review**: assistant and accessibility capabilities require justification.
  For one phone, sideload the APK and skip the store entirely.
- **Privacy**: photos of documents and medical papers leave the phone and go to a
  model API. Keep the server single-user, no analytics, no third-party CDN, and say
  plainly where files are stored and for how long.
- **HEIC** from iPhone needs conversion before the model sees it; Android gives JPEG.
  If the phone is Android, this disappears.
- **Cost and latency**: page images are token-heavy; cap pages per message (e.g. 30)
  and show a progress state instead of a spinner.
- **One user means no pressure to keep it running.** Backups and a health check are
  part of the product, not an afterthought.

## Open questions

1. Android or iPhone? It decides whether phases 2 and 3 exist at all.
2. Which API key/provider: the existing OpenCode gateway, or a direct Gemini key?
3. Hostname and whether it should be reachable outside the home network.
4. Voice-first or typing-first for the main use (recipes, prescriptions, school papers,
   screenshots of chats)?
