# STT roadmap after GigaAM

Status on 2026-11-07. Host dictation now runs GigaAM v3 on Frankfurt (see
`docs/decisions.md`). Browser speech stays the first path in Chrome, Edge and
Safari. The options below are not implemented; this file records the numbers
and the wiring so they can be picked up later.

## Done

| Option | What runs | Result |
| --- | --- | --- |
| GigaAM v3 CTC + punctuation | `bin/gigaam` sidecar on `127.0.0.1:8177`, `sherpa-onnx` | RTF 0.10–0.13, punctuation and capitals, 217 MB model, ~300 MB RSS |

## Pending

### 1. Groq free tier

- **What**: `whisper-large-v3-turbo` through `https://api.groq.com/openai/v1/audio/transcriptions`.
- **Price**: $0.04 per audio hour; free plan included.
- **Free limits**: 2 000 requests/day, 7 200 audio seconds/hour, 28 800 audio
  seconds/day, 20 requests/minute. With 3-second chunks that is roughly
  1.5–2 hours of dictation per day.
- **Quality**: Whisper large-v3-turbo, good Russian, punctuation and capitals.
- **Streaming**: no, file upload per chunk. Reuse the existing silence chunking
  in `Composer.tsx`; expected 0.3–1 s per chunk.
- **Key**: free Groq account, no card.
- **Wiring**: add a REST provider next to `/inference` in
  `internal/server/stt_fast.go` or a new `/api/stt?mode=groq`; keep the key in
  `~/.config/nit-gui/` and proxy it from the host, never the browser.
- **Privacy**: audio leaves the host to Groq.

### 2. Deepgram Nova-3 streaming

- **What**: WebSocket streaming, interim words while speaking.
- **Price**: $0.0077/minute streaming ($0.46/hour).
- **Free**: $200 credit, no card, no expiry, about 26 000 streamed minutes
  (~430 hours).
- **Russian**: supported by Nova-3 monolingual.
- **Streaming**: real partial results, the only cloud option here that gives
  word-by-word text like the Google keyboard.
- **Wiring**: new WebSocket bridge in Go (browser → nit-gui → Deepgram), since
  the key must stay on the host. Larger than the Groq path.
- **Privacy**: audio leaves the host to Deepgram.

### 3. Browser WASM

- **Vosk small-ru** (~45 MB, ~300 MB RAM): runs in Firefox, real-time streaming,
  no punctuation or capitals, accuracy clearly below Google. Only useful as an
  offline fallback; not a replacement for GigaAM.
- **GigaAM in WASM**: 217 MB model, too heavy for a tablet; the host sidecar is
  the better place for it.

### 4. System keyboard dictation

- No code. The composer is a `<textarea>`, so Gboard, Windows voice typing and
  macOS Dictation work there and are usually the fastest option where the
  browser has no Web Speech.

## Order

1. Groq first if a free key is acceptable: smallest change, best cost.
2. Deepgram second if true interim text matters; needs a WebSocket bridge.
3. WASM only if offline Firefox dictation without the host becomes a hard
   requirement.
