# Nita: a personal Android assistant with hands

Working name: **Nita**. Short, one word, no persona behind it; the label and icon
can change without touching code.
Status: concept v5, decisions from the 2026-11-07 review applied. Nothing built.
Target user: one person (the author's wife), Android only, not a developer.

## Locked decisions

| Decision | Value |
| --- | --- |
| Platform | Android only. No iOS, no web build. |
| Distribution | Sideloaded APK, personal use, no Play Store. |
| Accounts | One static token in the APK. No users, no login screen. |
| Server | Yes: an agent needs a home, a workspace and a sandbox. |
| Runtime | OpenCode in a container, with a custom `nita` agent. |
| Key | Stays on the server. Never reaches the phone. |
| Voice | No TTS, no in-app dictation. The keyboard types by voice. |
| Themes | All 13 themes from nit-gui plus "system". |
| Chat list | Left drawer. The attachment sheet stays at the bottom. |
| Modes | None. One base prompt; the model infers intent. |
| Overlay | No canned actions. Attach the screen or the region, ask freely. |
| History | Server is the source of truth; export is a button, nothing scheduled. |

## Why the server came back

The previous version was a chat client talking to the gateway directly: no server,
no auth, no hosting. That was the right shape while Nita only answered questions.

Memory across chats, a catalog of documents, saved words, Anki decks and shell for
non-trivial tasks all need three things a phone cannot give: a persistent
workspace, a real tool loop, and a place where a script can run without touching
the phone. That is a server. Once it exists, the key belongs there too, and the
phone becomes a thin client.

What it costs, honestly:

- one static token comes back (not a login; a string in the APK);
- history now depends on the box being alive, so export matters more;
- a container and its updates are now part of the product;
- the attack surface is an agent with a shell, reachable over the internet.

What it buys: the agent can keep files between chats, read the archive, build
decks, and run the 30-line script that saves an hour.

## Architecture

```
phone (Capacitor)
  chat UI · drawer · camera/scanner · share · assist overlay · themes
        │  HTTPS + static token
        ▼
Caddy on frankfurt
        │
        ▼
nita-proxy (Go, thin)
  /api/chats, /api/chats/{id}/messages, /api/events   → OpenCode
  /api/upload            → /srv/nita/work/inbox
  /api/memory/*          → docs, words, notes, anki
  /api/export            → zip of sessions + workspace
  /api/token             → nothing; the token is a header
        │  localhost only
        ▼
OpenCode container  ← the sandbox
  agent "nita", base prompt, tools: bash, read, write, edit, grep, glob
  sees only /work; no host mounts; no internet except the gateway
        │  allowlisted egress
        ▼
opencode.ai inference gateway
```

Why a proxy instead of the app talking to OpenCode: it hides the OpenCode
password, owns the single token, uploads attachments into the workspace, exposes
memory and export, and filters verbose tool events into one-line "делает…"
entries. It is nit-gui's server with most of it deleted.

Why OpenCode instead of a hand-written agent loop: it already has sessions,
attachments, tool calls, permissions, compaction, cost accounting and model
routing, and it runs on this machine today. A custom loop would duplicate all of
that before the first useful feature.

## Sandbox

The agent has a shell, and it reads documents and screenshots written by other
people. Prompt injection is not a hypothetical here, so the container is the
boundary, not a review step.

- Rootless container (podman preferred on NixOS), read-only root filesystem,
  `--cap-drop=ALL`, no host mounts except the named volume `/work`.
- `--memory=1g`, `--pids-limit=256`, CPU limit; one command capped at 60 s by the
  prompt, and a hard timeout in the runner.
- Network namespace with an egress allowlist: only the model gateway. No LAN, no
  internet, no DNS beyond what the proxy needs.
- The model key lives in the container env. A malicious script can read it and
  spend money; it cannot ship data anywhere else. Rotate the key if that ever
  happens.
- Attachments are copied into `/work/inbox` by the proxy, never into the host.
- The workspace is backed up nightly on the host with a simple tar; the app's
  export button is the user-facing copy.

## Memory

The workspace is the agent's brain. Files, not a new database, because the agent
already knows how to read and grep files.

```
/work/
  AGENTS.md            rules of the workspace, loaded by OpenCode
  chats/               one markdown transcript per chat, written by the proxy
  inbox/               uploaded originals, dated
  docs/
    index.md           catalog: date · name · one line · path
    2026-11-07-анализы.pdf
    2026-11-07-анализы.md
  memory/
    words.md           word | translation | example | date
    notes.md           durable facts and decisions
  out/                 anki-YYYY-MM-DD.apkg, scripts output
  scripts/             the agent's own scripts
```

- The proxy writes `chats/<id>.md` after every completed turn, so "что я присылала
  про анализы в марте" is a grep, not a guess.
- The agent maintains `docs/index.md` and the `.md` extraction next to each
  original.
- `words.md` and `notes.md` are append-only; deletion needs confirmation.
- Anki is a script: `genanki` in the image, output in `out/`, download link in the
  chat.

## Base prompt

Draft: `2026-11-07-nita-prompt.md`. It covers answer style, formatting, the memory
protocol, document citations, sandbox rules and the Anki workflow. The short
version:

- answer first, details after; no introductions, no name, no persona;
- one clarifying question maximum, and only when the answer would otherwise be wrong;
- never invent numbers, dates, doses; medical, money and legal answers carry a
  one-line disclaimer;
- language corrections use a fixed shape: `fix` block, 2–4 bullets, `try` block;
- a document question quotes verbatim with a page number;
- memory is append-only; new document → save, catalog, extract, then answer;
- shell only inside `/work`, no network, no package installs, no deletions without
  a confirmation;
- "make cards" → build an `.apkg` and say where it is.

The prompt is tuned against five real dialogues in wave 0: a Turkish correction, a
10-page contract question, "что я присылала в марте", a spreadsheet question, and
"сделай карточки из этого чата".

### Formatting contract

The app renders four fenced languages specially; everything else is normal
markdown. This is how the answer looks "rich" without any modes or chips:

| Fence | Rendering |
| --- | --- |
| `fix` | green left border, the corrected phrase |
| `try` | amber left border, one exercise |
| `note` | muted box, one short warning |
| `words` | two-column table from `word | translation` lines |

Any other fence stays a plain code block, which is a safe failure.

## No modes, no chips

No "Турецкий", no "Документы", no "Исправь / Переведи / Объясни правило". One
assistant, one prompt, free-form input. The model infers the intent; the app only
renders text. If a repeated behavior is needed later, it goes into the prompt, not
into a new screen.

## Chat list from the side

The attachment sheet already owns the bottom of the screen, so the chat list is a
left drawer: 78% width, full height, dimmed chat behind, rounded right edge,
search over chats and documents, rows with a snippet, a document badge and a
mono timestamp, the current chat marked with an amber bar, "+" for a new chat.
The footer shows the size of the memory: `14 документов · 86 слов`.

Opening: the menu button in the header, or an edge swipe from the left.

## Themes

All of them, ported as-is: Stock light, Stock dark, Nord, Solarized, Gruvbox,
Dracula, Paper, Paper Dark, Ember, Kiln, Mist, Ash, Ash Dark, plus "system".
Two-column grid, each tile previews itself, instant switch, status and navigation
bar repaint. Light themes need a contrast pass on the composer and the overlay.

## Screens

1. **Chat** — header, transcript, tool activity lines, composer. Tapping the menu
   opens the drawer.
2. **Drawer** — chats, search, memory size, new chat, settings.
3. **Document** — the page, pinch-zoom, cited clause highlighted, ask about page.
4. **Capture** — Документ (scan), Фото, Из галереи, Файл, recent documents.
5. **Settings** — themes, export/import, memory, about.
6. **Assist overlay** — screenshot or region attached, one free-form input.

The mock is in `2026-11-07-mobile-companion.html`.

## Документ vs Фото

- **Документ** — ML Kit Document Scanner: edges, perspective, multi-page, one PDF.
  For contracts, test results, receipts, textbook pages.
- **Фото** — the ordinary camera, one JPEG, no processing. For a whiteboard, a
  label, a plant, a child's drawing.

Naming by outcome, one hint line each. No mode switch inside one camera.

## Assist overlay

The gesture gives a screenshot, the text structure of the screen and the source
app. All three are attached. The overlay shows the dimmed screenshot, an optional
freehand lasso, a chip `Фрагмент экрана · 240 × 120 · текст приложен`, and one
input. Empty send means "Что это?". The answer opens as a normal chat named after
the source app.

Tap-on-text is the advantage over Circle to Search: `AssistStructure` gives the
real text nodes, so tapping a number selects exactly that field.

## Reading documents well

1. ML Kit Document Scanner before the model sees anything.
2. Original file, no downscale, no re-encode, EXIF location stripped.
3. PDF native to the model; no OCR step for the model (the `.md` extraction is for
   search and memory, not for the answer).
4. `xlsx`/`csv` → markdown tables per sheet; `docx` → text plus images.
5. Two-pass on dense pages: whole page, then a 2× crop of the area in question.
6. Cache extracted text per document hash; cite pages; quote verbatim.

## Models

| Input | Model | Why |
| --- | --- | --- |
| Text with tools | `deepseek-v4.1-flash` | Same as the dev app, $0.15/$0.60, supports tools and images. |
| PDF / scan in the same turn | `gemini-4-argon` | Native PDF and strong layout reading, $2/$10. |
| Hard page | `gemini-4-argon` | Same, chosen by the app when a document is attached. |

No model picker. A 10-page PDF costs about one cent.

## Phases

Part 1 (now): concept. Part 2: build with parallel subagents, one task per agent.

| Wave | Tasks | Why this order |
| --- | --- | --- |
| 0 | Container + proxy + token + workspace + `nita` agent + prompt v1; app scaffold, tokens and themes, transport, streaming | The sandbox and the prompt define everything else; one hand. |
| 1 | Chat and tool activity · drawer and search · composer and capture · PDF page viewer · settings and export · Android shell, share intent, camera and scanner | Independent once wave 0 exists; 6 agents in parallel. |
| 2 | Assistant role: `VoiceInteractionService`, screenshot, overlay, lasso, tap-on-text | Needs the shell from wave 1; one agent, device testing. |
| 3 | Memory screens (documents, words, decks) · Anki job · polish · light themes | After the flows exist. |

Acceptance: `bin/check` green, APK on the phone, and these eight work — page photo
with a citation; 10-page PDF; spreadsheet; "что я присылала в марте"; save a word
and see it in `words.md`; build an Anki deck and open it; share from another app;
long-press home over another app, lasso, free-form question.

## Risks

- **Prompt injection from documents and screenshots.** The container is the
  boundary: no host mounts, no network except the gateway, resource limits. Review
  the container flags before the first deploy.
- **Container escape** is a kernel bug away. Rootless podman, updated image, no
  extra capabilities, nothing valuable mounted.
- **The key sits in the container.** A script can read it and spend money; it
  cannot exfiltrate elsewhere. Rotate on suspicion.
- **OpenCode is a coding agent.** Its instincts are plans and diffs. The base
  prompt and the agent config must tame it; test on real dialogues, not on
  one-liners.
- **The static token is in the APK.** Fine for one phone; rotate if the APK leaks.
- **SSE through the proxy** must be unbuffered end to end, or answers arrive in
  chunks at the end.
- **Anki generation can take a minute.** Run it as a job and notify, not inside the
  chat turn.
- **The workspace grows.** Cap uploads per file and total, prune `inbox/` after the
  document is filed.

## Open questions

1. Anki: `.apkg` (needs `genanki` in the image) or CSV/TSV that she imports herself?
2. Memory screen in v1, or only chat until later?
3. Container runtime on frankfurt: is rootless podman already set up?
4. Keep every chat forever, or add retention after a year?
