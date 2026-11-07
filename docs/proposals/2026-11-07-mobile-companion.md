# Nita: a personal Android assistant with hands

Working name: **Nita**. Short, one word, no persona behind it.
Status: concept v6, decisions from the 2026-11-07 review applied. Nothing built.
Target user: one person (the author's wife), Android only, not a developer.

## Locked decisions

| Decision | Value |
| --- | --- |
| Platform | Android only. No iOS, no web build. |
| Distribution | Sideloaded APK, personal use, no Play Store. |
| Accounts | One static token in the APK. No users, no login screen. |
| Server | Yes: an agent needs a home, a workspace and a sandbox. |
| Runtime | OpenCode in a container, one `nita` agent. |
| Key | Stays on the server. Never reaches the phone. |
| Voice | No TTS, no in-app dictation. The keyboard types by voice. |
| Themes | All 13 themes from nit-gui plus "system". |
| Chat list | Left drawer. The attachment sheet stays at the bottom. |
| Modes | None. One base prompt; the model infers intent. |
| Overlay | No canned actions. Attach the screen or the region, ask freely. |
| Storage | 5 GB total. Oldest chat is deleted automatically. |
| Process | Hidden. No tools, no steps, no reasoning, no paths in the UI. |
| Extra screens | None. No documents, no words, no decks. |

## Why the server came back

A chat client could talk to the gateway directly. An assistant with hands cannot:
memory between chats, files, scripts and long-running work need a persistent
workspace and a real tool loop. So the server is not a proxy for the key anymore,
it is the agent's home.

What it costs: one static token, history depends on the box, a container to keep
updated, and an agent with a shell reachable over the internet. What it buys: the
agent solves its own problems with files and code, and keeps what it needs between
chats.

## Architecture

```
phone (Capacitor)
  chat UI · drawer · camera/scanner · share · assist overlay · themes
        │  HTTPS + static token
        ▼
Caddy on frankfurt
        ▼
nita-proxy (Go, thin)
  /api/chats, /api/chats/{id}/messages, /api/events   → OpenCode
  /api/upload            → /work/chats/{id}/inbox
  /api/files/{id}        → files the agent produced
  /api/export            → zip of sessions + workspace
  /api/usage             → 5 GB meter
  filters tool parts and reasoning out of the stream
        ▼
OpenCode container (sandbox)
  agent "nita", base prompt, tools inside /work only
        ▼  allowlisted egress
opencode.ai inference gateway
```

The proxy exists because the app should never see OpenCode's password, tool calls,
file paths or reasoning. It also owns uploads, file delivery, export and the
storage quota.

## The agent's process is invisible

This is a product rule, not a styling choice.

- The proxy drops tool parts, reasoning deltas, command output and file paths from
  the event stream. The app receives text, a status, and final files.
- The UI shows a quiet typing state while a turn runs. No "думает", no "ищет в
  памяти", no tool names, no step list.
- Errors are phrased for a person: "не получилось открыть файл", plus a retry
  button. Technical details go to the server log only.
- The base prompt forbids narrating the process and mentioning paths.
- If the agent needs to say what it did, it says the outcome: "готово, таблица в
  файле".

## Storage: 5 GB, oldest chat out

- The budget is 5 GB for everything the agent keeps: chat transcripts, uploaded
  documents, generated files, the OpenCode database.
- Measured after each turn and on upload. When over budget, the oldest chat is
  removed entirely: its session, its transcript, its inbox, its outbox. No
  warning, no archive.
- Shared notes live outside the per-chat folders and are small, so they survive.
  The currently open chat is never evicted.
- The drawer footer shows `1,2 ГБ из 5 ГБ` with a thin bar. Settings shows the
  same and explains that old chats are removed automatically.
- Consequence, stated once in settings: a chat older than the retention can
  disappear. If something matters, export it.

Workspace, one folder per chat so eviction is a single delete:

```
/work/
  memory/notes.md        shared, survives eviction
  chats/<id>/
    inbox/               uploads for this chat
    out/                 deliverables for this chat
    chat.md              transcript, written by the proxy
```

The agent's working directory is its chat folder. `/work/memory` and
`/work/chats` are visible for cross-chat recall.

## Files are the result

When the user asks for a document, a table, a PDF or a picture, the agent writes
it to `out/` with a sensible name. After the turn the proxy lists files created or
changed in `out/` and attaches them to the answer.

The app renders a file card: name, type, size, download. Images and PDFs preview
inline; everything else downloads or opens with the system viewer. The agent never
pastes a path or a base64 blob into the chat.

## Sandbox

The agent reads documents and screenshots written by other people. Prompt
injection is expected, so the container is the boundary.

- Rootless container (podman preferred on NixOS), read-only root filesystem,
  `--cap-drop=ALL`, no host mounts except the workspace volume.
- `--memory=1g`, `--pids-limit=256`, CPU limit; a hard 60 s timeout per command.
- Network namespace with an egress allowlist: only the model gateway. No LAN, no
  internet, no package installs at runtime.
- Image includes the tools an assistant needs: python3, poppler-utils,
  imagemagick, libreoffice, pandoc, tesseract with rus+eng. Installed at build
  time, when the network is allowed.
- The model key lives in the container env. A malicious script can read it and
  spend money; it cannot ship data anywhere else. Rotate if that ever happens.
- The workspace is backed up nightly on the host. The app's export button is the
  user-facing copy.

## Base prompt

Draft: `2026-11-07-nita-prompt.md`. Principles:

- answer first, details after; no introductions, no name, no persona;
- one clarifying question maximum, only when the answer would otherwise be wrong;
- never invent numbers, dates, doses; medical, money and legal answers carry a
  one-line disclaimer;
- language corrections use a fixed shape: `fix` block, 2–4 bullets, `try` block;
- document answers quote verbatim with a page number;
- never describe the process: no tools, no commands, no paths, no steps;
- shell only inside the workspace, no network, no deletions without confirmation;
- deliverables go to `out/`; the app shows them as files.

No Anki, no deck format, no domain workflows in the prompt. Those are problems the
agent solves on request with its tools, not features we build.

### Formatting contract

The app renders four fenced languages specially; everything else is normal
markdown. This is how an answer looks rich without modes or buttons.

| Fence | Rendering |
| --- | --- |
| `fix` | green left border, the corrected phrase |
| `try` | amber left border, one exercise |
| `note` | muted box, one short warning |
| `words` | two-column table from `word | translation` lines |

Any other fence stays a plain code block — a safe failure.

## No modes, no chips

No "Турецкий", no "Документы", no buttons that pre-fill a command. One assistant,
free-form input. If a behavior repeats, it belongs in the prompt, not in a new
screen.

## Chat list from the side

The attachment sheet owns the bottom, so the list is a left drawer: 78% width,
full height, dimmed chat behind, search, snippet, document badge, mono timestamp,
the current chat with an amber bar, "+" for a new chat, and the storage meter at
the bottom. Opens from the header button or an edge swipe.

## Themes

All 13 plus "system", same two-column grid as `ThemePicker.tsx`, each tile
previewing itself, instant switch, status and navigation bar repaint. Light themes
need a contrast pass on the composer and the overlay.

## Screens

1. **Chat** — header, transcript, composer, file cards.
2. **Drawer** — chats, search, storage meter, new chat, settings.
3. **Document** — the page, pinch-zoom, the cited clause highlighted.
4. **Capture** — Документ (scan), Фото, Из галереи, Файл.
5. **Settings** — themes, export/import, storage, about.
6. **Assist overlay** — screenshot or region attached, one free-form input.

The mock is in `2026-11-07-mobile-companion.html`.

## Документ vs Фото

- **Документ** — ML Kit Document Scanner: edges, perspective, multi-page, one PDF.
  For contracts, test results, receipts, textbook pages.
- **Фото** — the ordinary camera, one JPEG, no processing. For a whiteboard, a
  label, a plant, a child's drawing.

Naming by outcome, one hint line each.

## Assist overlay

A screenshot, the text structure of the screen and the source app are attached.
The overlay shows the dimmed screenshot, an optional freehand lasso, a chip with
the size and "текст приложен", and one input. Empty send means "Что это?". The
answer opens as a normal chat named after the source app.

Tap-on-text beats Circle to Search: `AssistStructure` gives real text nodes, so
tapping a number selects exactly that field.

## Reading documents well

1. ML Kit Document Scanner before the model sees anything.
2. Original file, no downscale, no re-encode, EXIF location stripped.
3. PDF native to the model; no OCR step for the answer.
4. `xlsx`/`csv` → markdown tables per sheet; `docx` → text plus images.
5. Two-pass on dense pages: whole page, then a 2× crop of the area in question.
6. Cite pages, quote verbatim, keep numbers as written.

## Models

| Input | Model | Why |
| --- | --- | --- |
| Text with tools | `deepseek-v4.1-flash` | Same as the dev app, $0.15/$0.60, tools and images. |
| PDF or scan | `gemini-4-argon` | Native PDF and strong layout reading, $2/$10. |

No model picker. A 10-page PDF costs about one cent.

## Phases

Part 1 (now): concept. Part 2: build with parallel subagents, one task per agent.

| Wave | Tasks | Why this order |
| --- | --- | --- |
| 0 | Container + proxy + token + workspace + `nita` agent + prompt v1 + 5 GB eviction; app scaffold, tokens and themes, transport, streaming | The sandbox and the prompt define everything else; one hand. |
| 1 | Chat and hidden tool stream · drawer and search · composer and capture · PDF page viewer · file cards · settings and export · Android shell, share intent, camera and scanner | Independent once wave 0 exists; 6 agents in parallel. |
| 2 | Assistant role: `VoiceInteractionService`, screenshot, overlay, lasso, tap-on-text | Needs the shell from wave 1; one agent, device testing. |
| 3 | Polish: motion, empty and error states, light themes, retention meter | After the flows exist. |

Acceptance: `bin/check` green, APK on the phone, and these seven work — page photo
with a citation; 10-page PDF; spreadsheet; "что я присылала в марте"; ask for a
file and get a download card; share from another app; long-press home over another
app, lasso, free-form question.

## Risks

- **Prompt injection from documents and screenshots.** The container is the
  boundary: no host mounts, no network except the gateway, resource limits.
- **Container escape** is a kernel bug away. Rootless podman, updated image, no
  extra capabilities, nothing valuable mounted.
- **The key sits in the container.** A script can spend money; it cannot exfiltrate
  elsewhere. Rotate on suspicion.
- **OpenCode is a coding agent.** Its instincts are plans and diffs. The prompt and
  the agent config must tame it; test on real dialogues.
- **Silent eviction at 5 GB** can remove something important. The meter and the
  one-line explanation in settings are the only warning; export is the answer.
- **The static token is in the APK.** Fine for one phone; rotate if it leaks.
- **SSE through the proxy** must be unbuffered end to end.
- **The agent may put junk in `out/`.** Filenames are the agent's job; the proxy
  only attaches what changed during the turn.

## Open question

1. Container runtime on frankfurt: is rootless podman already set up, or do we use
   docker in rootless mode?

Everything else is decided. Next step is wave 0: container, proxy, prompt v1, and
the app skeleton, then the five acceptance dialogues to tune the prompt.
