# nit-gui evaluator

Check the task against BRIEF.md.

Must be true:
- `./bin/check` is green (Go tests/build, npm typecheck/test/build).
- The backend talks to the live OpenCode service and never exposes the password
  to the browser.
- A session can be created, a prompt sent, text streamed and stopped.
- Markdown, code, tool calls and HTML preview render; HTML is inside a sandboxed
  iframe without `allow-same-origin`, never injected into the app DOM.
- Layout works at 1280 and 900; loading/offline/error states are real.
- README covers run, env, security, dependencies.
- No comments except machine directives and `shortcut:` notes.

End with `VERDICT: PASS` or `VERDICT: FAIL`.
