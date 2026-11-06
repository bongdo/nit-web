# LanguageTool 6.6 benchmark

Measured on 2026-11-06 on the development host: 4 cores, 24 GB RAM, 9 GB free
disk. Nix package `languagetool-6.6`, OpenJDK 21 minimal JRE, server started
with `-Xms256m -Xmx512m`.

## Startup and memory

| Metric | Value |
| --- | --- |
| HTTP ready (`/v2/languages`) | 1.8 s |
| RSS at ready | 256 MB |
| First Russian check | 2.9 s |
| First English check | 3.3 s |
| RSS after both languages warm | 729 MB |
| LanguageTool package | 392 MB |
| JRE | 92 MB |
| Nix closure with runtime deps | 811 MB |

The first check is slow because the language modules load lazily. A prewarm
request for RU and EN at startup would move that cost out of the user's first
check.

## Warm latency

Short prompts of 50–110 characters, 20–30 runs each:

| Sample | Median | p95 |
| --- | --- | --- |
| Russian, typo-heavy | 257 ms | 281 ms |
| Russian, short | 245 ms | 269 ms |
| Russian, grammar-only | 238 ms | 280 ms |
| English, typo-heavy | 38 ms | 46 ms |
| English, short | 26 ms | 34 ms |

Russian is about six times slower than English and stays around 240 ms even
when spelling rules are disabled. English is in the 25–45 ms range. The server
used no cache; a sentence cache would only help repeated text.

## Quality

Russian:

- `хочю` → `хочу` (with `холю`, `хорю` as alternatives).
- `граматики` → `грамматики`.
- `проверку но` → `проверку, но` (missing comma caught).
- `но не хочу чтобы` → the missing comma before `чтобы` was **not** caught.
- `Composer.tsx` and `bin/check` were not flagged.
- `UPPERCASE_SENTENCE_START` fires on every lowercase prompt start and should be
  disabled for a composer.

English:

- `too add` → `to add` (`TOO_TO`), which nspell cannot catch.
- `grammer` → `grammar`.
- Lowercase `i` → `I`; also disable if prompt case is intentional.
- The rest of the sample was left alone.

## Verdict

On this host LanguageTool is affordable: ~0.7 GB RSS and ~0.8 GB of Nix
closure. On a 1 GB VPS it would be most of the available memory. Startup is
fine if the service is prewarmed; warm Russian checks are usable behind a
500–700 ms debounce, but not per keystroke. English is fast enough for a
shorter debounce.

Options:

1. **Sidecar only.** Replace nspell with `/api/check` calls to LanguageTool.
   Simpler data model (offsets and replacements), but loses instant feedback
   and adds Java to the deployment.
2. **Hybrid.** Keep nspell for instant spelling and add LanguageTool for
   grammar on a longer pause or on demand. Best feedback, more merging and
   deduplication work.
3. **Keep nspell.** Zero server memory and no network edge, but no real-word
   errors (`too`/`to`) and no punctuation.

The measured numbers do not justify replacing nspell for spelling alone. They
do justify LanguageTool if grammar and real-word errors matter and the target
host has at least 1.5 GB free RAM.

Decision on 2026-11-06: hybrid, nspell for spelling plus an optional
LanguageTool sidecar for grammar. See `docs/decisions.md`.
