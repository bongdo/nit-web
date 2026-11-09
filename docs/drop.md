# Drop

`/nit/drop/` is a temporary file buffer, static web host and document reader
inside nit-gui. It is behind the shared `nit_gate` login and is linked from the
chat header.

## Agent commands

`bin/drop` is on `PATH` through direnv.

```sh
drop ./report.html
drop ./screenshots.zip
drop web ./web/dist
drop docs ./vault
drop list
drop url d-0123456789abcdef
drop rm d-0123456789abcdef
```

Each command prints a public URL on the first line and `<id> <kind> <ttl>` on
the second. Give the URL to the user; do not paste a whole HTML document into a
chat reply.

`drop web` requires `index.html`. `drop docs` opens the reader at the first
markdown file (`index.md`, `README.md`, then the first `.md`). A single file is
copied under its base name. A directory is copied recursively; symlinks and
non-regular files are skipped.

## TTL

The default is 7 days. `--ttl` accepts `1h`, `24h`, `7d`, `2w`, `0` (never).
Expired entries are deleted when a list or an entry is read.

## URLs

- `/nit/drop/` — the buffer.
- `/nit/drop/e/<id>/` — the entry page.
- `/nit/drop/e/<id>/?file=path.md` — the reader.
- `/nit/drop/files/<id>/path` — raw file or site asset.
- `/nit/drop/download/<id>/path` — download with `Content-Disposition`.

Relative links in Markdown resolve inside the same publication. Links that
escape it are disabled. `.md`, `.txt`, logs and code open in the reader;
images, PDFs and HTML get a preview; other files get a download link.

## Security

- The same `nit_gate` cookie as nit, pero and term. There is no anonymous
  access and no second password.
- Uploads are limited to 128 MiB per request (`NIT_DROP_MAX_UPLOAD`).
- HTML is served with `Content-Security-Policy: sandbox`; it has an opaque
  origin, no `fetch`/XHR/WebSocket and no form submission. Self-contained
  scripts, styles and images work; an app that calls the nit-gui API does not.
- The store is `$NIT_DROP_ROOT` (default `~/.local/share/nit-gui/drop`), one
  `0700` directory per entry with a `0600` `entry.json`. Path traversal and
  `entry.json` requests are rejected.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `NIT_DROP_ROOT` | `~/.local/share/nit-gui/drop` | Store directory. |
| `NIT_DROP_MAX_UPLOAD` | `134217728` | Upload limit in bytes. |
| `DROP_PUBLIC_BASE` | `https://frankfurt.tailf358cb.ts.net/nit/drop/` | Base used by `bin/drop`. |
