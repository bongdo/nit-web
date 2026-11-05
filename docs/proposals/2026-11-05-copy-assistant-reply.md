# Copy a whole assistant reply from the transcript

## Problem

Every fenced code block has a Copy button, but the reply around it does not.
Selecting a long answer by hand breaks at collapsed tool calls, scrolled code
blocks and streaming text, so the common task "take this answer somewhere else"
turns into a re-prompt or a partial selection. The browser's selection also
copies rendered text, not the markdown the user may want (headings, lists,
fences).

Screen: transcript, assistant message header next to the model name and time.

## Smallest change

- Add `replyText(message: Message): string` to `web/src/lib/format.ts`: join the
  message's `text` parts with a blank line; ignore reasoning and tool parts.
- In `MessageRow.tsx`, render a ghost icon button (`Copy` / `Check`, same pattern
  as `CodeBlock`) when `replyText(message)` is non-empty. Click calls the
  existing `copyText` and shows `Copied` for 1.5 s.
- Add one case to `format.test.ts`: two text parts plus a tool part produce the
  two texts joined by a blank line.

No new dependency, no server change.

## Acceptance check

Unit: `npm --prefix web run test` covers the join helper.

Browser: `./bin/run`, open a session and send "Show a heading, a sentence and a
fenced code block". On the finished reply click **Copy**. Paste into the
composer: the text is the raw markdown, including the fence lines, with no
agent, model or timestamp prefix. The button switches to "Copied" and back.
A reply with only tool calls shows no Copy button. Streaming replies either hide
the button or copy the partial text; either way a click must not error.

## Risks

- Clipboard writes need a user gesture; the click is one, and `copyText` already
  has an `execCommand` fallback for browsers that deny the async API.
- Very large replies are stringified on click; the upstream cap keeps this in the
  megabyte range.
- Copying markdown source (fences kept) is deliberate. A user who wants plain
  text will get fences; the alternative, stripping markdown, would lose code
  indentation and is a separate decision.
