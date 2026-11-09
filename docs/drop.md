# Drop

`/nit/drop/` is the private manager inside nit-gui. It uses the `nit_gate`
cookie and is linked from the sidebar. Published content lives under `/nit/d/`;
the manager is not public.

## Agent commands

`bin/drop` is on `PATH` through direnv.

```sh
drop ./report.html
drop ./screenshots.zip
drop ./web/dist --slug app
drop ./vault --slug docs
drop list
drop url d-0123456789abcdef
drop rm d-0123456789abcdef
drop slug d-0123456789abcdef docs-v2
drop access d-0123456789abcdef public
```

Each publish prints a public URL on the first line and `<id> <slug>
<access> <expiry>` on the second. Give the URL to the user; do not paste a whole
HTML document into a chat reply.

Default: private and permanent. `--public` allows anonymous reads. `--expire
2w` deletes after two weeks. `--slug name` picks the URL; without it the slug
comes from the file or folder name. `drop web` and `drop docs` are accepted
aliases but do not change the output. A single file is copied under its base
name. A directory is copied recursively; symlinks and non-regular files are
skipped.

## Model

An entry is one publication. It has an immutable id, a canonical slug, aliases,
a public flag, an optional expiry and a set of files. A single file is a
publication with one file. Publicity is per publication, not per file: a page
and its assets have one switch. Expiry is either permanent (`expires` absent) or
a timestamp.

Changing a slug appends the old canonical slug to aliases. Every alias resolves
to the same publication. Slugs and aliases are globally unique.

## URLs

- `/nit/drop/` — private manager: list, upload, public toggle, slug, expiry.
- `/nit/d/<slug>/` — publication root. It serves `index.html`, a single file,
  or a bare file list for a folder without an index.
- `/nit/d/<slug>/<path>` — a file or static asset.
- `/nit/drop/api/upload` — immediate multipart upload.
- `PATCH /nit/drop/api/entries/<id>` — change slug, public or forever.
- `DELETE /nit/drop/api/entries/<id>` — delete.
- `/nit/drop/e/<id>/`, `/nit/drop/files/<id>/...`,
  `/nit/drop/download/<id>/...` — redirects to the canonical `/nit/d/` URL.

Markdown, text and code are not rendered by drop. The manager shows an "open in
pero" link with the absolute store path; the raw file link points at `/nit/d/`.
PDF and images are served inline and left to the browser.

## Security

- The manager and writes require the same `nit_gate` cookie as nit, pero and
  term. `/nit/d/` is outside that gate: public entries are served anonymously,
  while a private entry needs a valid session cookie and otherwise returns 404
  without revealing that it exists.
- Uploads are limited to 128 MiB per request (`NIT_DROP_MAX_UPLOAD`).
- Anonymous HTML is served only for public entries, with `Content-Security-Policy:
  sandbox` (opaque origin), `connect-src 'none'`, `form-action 'none'` and no
  access to nit-gui API cookies. Self-contained scripts, styles and images
  work. External images and scripts are not blocked; publish only content you
  trust.
- The store is `$NIT_DROP_ROOT` (default `~/.local/share/nit-gui/drop`), one
  `0700` directory per entry with a `0600` `entry.json`. Path traversal and
  `entry.json` requests are rejected. Dotfiles are hidden from the file index.
- Public responses carry `X-Robots-Tag: noindex, nofollow`.

## Migration

Old `entry.json` files are read on startup. Missing slugs are generated from the
old name or id; publicity defaults to false; an expiry of exactly seven days is
treated as the old default and removed. Explicit 1h/24h/30d expiries remain.
Old URLs redirect to the new slug. `drop url <id>` still works.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `NIT_DROP_ROOT` | `~/.local/share/nit-gui/drop` | Store directory. |
| `NIT_DROP_MAX_UPLOAD` | `134217728` | Upload limit in bytes. |
| `DROP_PUBLIC_BASE` | `https://frankfurt.tailf358cb.ts.net/nit/d/` | Base used by `bin/drop`. |
