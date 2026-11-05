# Preview HTML fences that have no language tag

## Problem

`CodeBlock` offers the sandboxed Preview toggle only when the fence language is
`html`, `htm` or `xhtml`. Models often emit a complete HTML document in a fence
with no language tag, and a fenced block is deliberately excluded from the
message-level HTML detection (`withoutCode`). Such a block therefore has no
preview anywhere: the user has to copy it into a file to see it. This is the
exact case the GUI exists for, and it is the most common way a page arrives in
chat.

Screen: transcript, code block header in an assistant or user message.

## Smallest change

- Add `previewableHtml(code: string, language?: string): boolean` to
  `web/src/lib/html.ts`: `true` when `isHtmlLanguage(language)`; when no language
  is present, `isPureHtml(code)`.
- Use it in `CodeBlock.tsx` instead of `isHtmlLanguage(language)`.
- Add cases to `html.test.ts`: unlabeled full document and unlabeled fragment
  preview; labeled `js` does not; unlabeled prose does not.
- Update the README line that mentions only a fenced `html` block.

The preview itself is unchanged: same `HtmlPreview`, same sandbox without
`allow-same-origin`.

## Acceptance check

Unit: `npm --prefix web run test` covers the new predicate.

Browser: `./bin/run`, create a session and send a message containing

    ```
    <!doctype html><html><body><h1>Hi</h1></body></html>
    ```

with no language after the opening fence. In the sent message bubble the block
header shows **Preview**; clicking it renders "Hi" in the iframe. In DevTools the
iframe has `sandbox="allow-scripts allow-forms allow-modals"` and no
`allow-same-origin`. Send the same block tagged `js`: no Preview button appears.

## Risks

- An unlabeled snippet that starts with a tag (for example JSX) is treated as
  HTML and gets an opt-in Preview button. Nothing auto-renders, so the failure
  mode is one extra button, not a broken message.
- `isPureHtml` already gates the message-level preview, so this reuses the same
  detection rules and does not widen what the app injects into its own DOM.
- Fenced content can still make network requests inside the sandbox; that is the
  existing documented preview risk, unchanged.
