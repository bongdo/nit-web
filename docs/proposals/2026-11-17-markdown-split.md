# Markdown renderer: take it out of the first chunk

## Problem

The production build is one 735 KB chunk (224 KB gz), and everything in it is
downloaded before the first screen, including the workspace picker that has no
markdown at all. Measured today: `react-markdown` + `remark-gfm` bundled alone
are 169 KB minified, 53 KB gz — about 23% of the initial JS.

That renderer is needed only when a transcript message is on screen. On a cold
load over a phone connection the picker waits for a markdown parser it will not
use yet.

## Smallest change

1. Add a thin lazy wrapper next to the existing component, no new dependency:
   `const Markdown = lazy(() => import("./Markdown").then((m) => ({ default: m.Markdown })))`
   in `web/src/components/MarkdownLazy.tsx`, and use it at the transcript call
   sites only (`AssistantTurn.tsx`, `MessageRow.tsx`). `ReviewSheet` and
   `HtmlMessagePreview` keep the direct import: they are already behind a click
   and would otherwise double-download the chunk.
2. Fallback while the chunk loads: the same `.markdown` wrapper with
   `white-space: pre-wrap` text, so the layout keeps its width and the text is
   readable for the ~50 ms the chunk takes on the same host. Streaming messages
   are the normal case, so the fallback must accept `streaming` without throwing.
3. Preload on idle once the app is interactive:
   `requestIdleCallback(() => import("./Markdown"))` in `Root.tsx`, so a user who
   opens a chat pays nothing extra.

No server change, no dependency, no change to the renderer itself.

## Acceptance check

- `npm --prefix web run build`: `Markdown-*.js` chunk ≥ 140 KB min, initial
  `index-*.js` ≤ 600 KB, gzip sum unchanged.
- `Markdown.test.tsx` and the whole suite stay green; add one case that the lazy
  wrapper renders the same markup as the direct import for a two-paragraph
  message.
- `bin/previews` shows the same picker as today.
- Manual: open a session with a long answer, a table and a fenced block;
  links in file paths stay clickable during streaming (the property fixed on
  2026-11-17). No visible flash of raw `**` before the chunk lands; if there is,
  keep the fallback to plain text, not raw markdown.

## Risks

- `Markdown` is imported from four places; a lazy wrapper used on a hot path and
  a direct import used elsewhere is fine (same module, one chunk), but a second
  `lazy()` call site would create a second chunk. Keep one wrapper.
- `Suspense` inside the transcript may remount code blocks when the chunk
  resolves; if the flash is visible, hoist the boundary above `ChatView` so the
  whole transcript waits once.
- Savings are 53 KB gz on the first paint, not on the chat view. If the goal is
  total transfer, this does not help.

## Rejected

- Replace `react-markdown` with `marked` or `micromark` directly: −100 KB and
  we re-implement tables, autolinks, task lists and the custom link/code
  components we already depend on. Not worth it for 53 KB.
- Syntax highlighting lazily: already a separate concern, `CodeBlock` does not
  pull a highlighter today.
