# Voice reading: fast start, technical text, voice mode

Status: streamed reading and speech rewriting implemented on 2026-11-07.
Voice mode and a persistent piper worker are proposals. See
`docs/decisions.md` for the recorded decision.

## Why the old button felt broken

`Read` sent the whole reply to `POST /api/tts/audio` and waited for piper to
finish the file before the browser could play anything. Measured on the
Frankfurt host:

| Reply | Synthesis time |
| --- | --- |
| 90 characters | 1.1 s |
| 370 characters | 2.9 s |
| 1500 characters | 15.4 s |
| 3000 characters with code | over the 60 s host timeout |

The OpenCode TTS hub was up with `clients=0`, so the hub-first request always
returned `no audio client`. The browser voice on a desktop without installed
voices produced nothing. So a long answer meant a spinner and silence.

## What the button does now

1. The reply is split into paragraphs and sentences on the client. Code fences
   are never split.
2. Each segment goes to `POST /api/tts/stream`. The server rewrites Markdown
   for speech and runs `piper --output_raw`, forwarding raw PCM as it is
   synthesized.
3. The browser schedules 16-bit mono PCM with Web Audio. The first chunk starts
   in 0.5–1.7 s; the next segment is fetched while the current one plays.
4. Fallbacks: whole-file `edge-tts`/piper, then the TTS hub, then browser
   `speechSynthesis`.

Selecting text inside a reply and pressing `Read` speaks the selection. The
button label changes to `Read selection`.

## How technical text is spoken

The listener needs to know that code and paths exist, not every character of
them. The rewriter keeps the kind, drops the payload.

| Source | Spoken |
| --- | --- |
| Fenced `go` block, 12 lines | `Блок кода на Go, 12 строк.` |
| `internal/server/tts.go` | `Файл tts точка go в папке internal server.` |
| `bin/check` | `bin check` |
| `https://github.com/foo/bar` | `Ссылка на github.com.` |
| `[документацию](https://example.com)` | `документацию` |
| `NIT_GUI_TTS` | `NIT GUI TTS` |
| `--output_raw` | `флаг output raw` |
| `7c868496fe43a1b2` | `хеш` |
| Markdown table | `Таблица.` |
| Image, emoji | dropped |
| `[x]` task marker, `#` heading, `-` bullet | marker dropped, text kept |

The rules are one pure function, `speechText` in
`internal/server/speech.go`, with table-driven tests. No model and no network
are involved.

## Models

| Engine | First audio | Full synthesis | Russian quality | Privacy | Verdict |
| --- | --- | --- | --- | --- | --- |
| piper `ru_RU-irina-medium` (local) | 0.5–1.7 s | about 2× realtime | good | text stays on host | default |
| edge-tts `ru-RU-SvetlanaNeural` | 1.2 s warm, 12.7 s cold | about realtime | very good | text goes to Microsoft | fallback |
| browser `speechSynthesis` | instant | realtime | device-dependent, often absent on Linux | device | last resort |
| piper low model | faster | faster | lower | local | worth a trial |
| cloud TTS API | network | network | best | text leaves host | rejected for now |

A persistent piper worker is the next real speedup: today every segment starts
a new process and reloads the ~63 MB model. The first chunk is fine; later
short paragraphs can wait. A worker that keeps the model in memory and accepts
JSON lines would remove that gap and is the right next step before adding more
engines.

## Voice mode

Auto-reading every new reply needs one product decision: when it starts and
when it stops.

Recommended shape:

- A `Voice` toggle next to `Read`. Turning it on is the user gesture that
  unlocks Web Audio.
- Only new assistant replies are read; existing history is not replayed.
- Reading starts while the reply is still streaming: completed paragraphs are
  queued, so the voice follows the answer instead of waiting for the end.
- Sending a new prompt, pressing `Stop`, or switching chats stops playback.
- The toggle is a device preference, not shared UI state.

This is a small addition on top of the current segment pipeline; the missing
part is a stream-aware segmenter that emits a paragraph once it is complete.

## Starting from a line

Text selection already covers the common case: select from a line to the end,
press `Read`, hear from there. A per-paragraph speaker button would be more
discoverable but adds markup to every block and a second place to cancel from.
Keep selection until users ask for the button.

## Open questions

- Does the user want voice mode on by default for new chats, or only when
  explicitly toggled?
- Is `irina-medium` good enough, or should the default switch to `edge-tts` for
  quality despite the cloud round-trip?
- Is a persistent piper worker worth the extra process lifecycle now, or after
  voice mode proves the feature is used?
