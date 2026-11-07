# Voice reading: fast start, technical text, voice mode

Status: streamed reading, speech rewriting and a warm piper worker are
implemented on 2026-11-07. Voice mode is still a proposal. See
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
   for speech and asks a warm piper worker (`--json-input`) for the WAV. The
   worker keeps the model in memory and serializes segments; the server
   forwards the PCM.
3. The browser schedules 16-bit mono PCM with Web Audio. A cold first segment
   starts in 0.5–1.7 s; after warmup each segment is ready in about 0.5 s, and
   the next segment is fetched while the current one plays.
4. Fallbacks: whole-file piper, then the TTS hub, then browser
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
| piper `ru_RU-irina-medium`, warm (local) | ~0.5 s per segment | about 2× realtime | good | text stays on host | default |
| piper `ru_RU-irina-medium`, cold | 0.9–1.7 s | about 2× realtime | good | text stays on host | only after restart |
| browser `speechSynthesis` | instant | realtime | device-dependent, often absent on Linux | device | last resort |
| piper low model | faster | faster | lower | local | worth a trial |
| edge-tts `ru-RU-SvetlanaNeural` | 1.2 s warm, 12.7 s cold | about realtime | very good | text goes to Microsoft | removed: cloud and slow cold start |
| cloud TTS API | network | network | best | text leaves host | rejected |

The warm worker is implemented. It starts during server warmup, holds the
model in memory (~140 MB RSS), and keeps the `piper` process alive until the
server restarts. Segments are serialized through one worker; that is enough
for one listener and avoids concurrent model copies. A pool would only be
needed for several simultaneous users.

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

## Firefox and other browsers

Firefox supports the two APIs this path needs: streaming `fetch` bodies and
Web Audio. The click on `Read` unlocks the `AudioContext`; playback is decoded
from PCM, not from a browser voice. Firefox on Linux often has no
`speechSynthesis` voices at all, so the old fallback was silent there; with the
warm host worker the browser voice is no longer on the main path.

## Starting from a line

Text selection already covers the common case: select from a line to the end,
press `Read`, hear from there. A per-paragraph speaker button would be more
discoverable but adds markup to every block and a second place to cancel from.
Keep selection until users ask for the button.

## Open questions

- Does the user want voice mode on by default for new chats, or only when
  explicitly toggled?
- Is `irina-medium` good enough, or should the default switch to a higher
  quality local piper voice?
