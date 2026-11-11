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
drop service ./app --slug app --public
drop start app
drop stop app
drop restart app
drop update app
drop logs app -f
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

## Services

`drop service <dir>` builds and runs a long-lived HTTP service in a rootless
podman container. The command waits for a health check and prints the public
URL, so the agent can publish in one step.

The directory must contain a `Containerfile` or `Dockerfile`, or a `drop.json`
with an `image`:

```json
{"port": 3000, "health": "/healthz", "cmd": ["python", "app.py"]}
```

`port` is the port inside the container (default 3000); `health` is the path
used for readiness (default `/`); `cmd` overrides the image command. With an
`image` and no Containerfile, the source directory is mounted read-only at
`/app` with `WORKDIR /app`. With a Containerfile, the image contains the code
and the directory is not mounted.

For an application with a server, a database or secrets:

```json
{
  "port": 3000,
  "health": "/api/health",
  "cmd": ["node", "server.js"],
  "env": {"NODE_ENV": "production", "DB": "/data/app.sqlite"},
  "env_file": ".env",
  "volume": "/data"
}
```

- `env` — plain values passed to the container. `PORT`, `HOST` and
  `NIT_DROP_BASE_PATH` are reserved.
- `env_file` — path inside the service directory, read on start and passed with
  `--env-file`. It is not copied into the image. The file must exist when the
  service is published or updated. Put secrets here.
- `volume` — an absolute container path, for example `/data`. The host side is
  `$NIT_DROP_VOLUMES/<entry id>` (default
  `~/.local/share/nit-gui/drop-volumes`), mode `0700`, and survives restarts.
  `drop rm` leaves the volume; delete the directory when the data is no longer
  needed. The image should run as root (the default); a `USER` directive may
  leave the volume unwritable.
- SQLite is the intended database. Keep the file under the volume
  (`/data/app.sqlite`) and only one container writes it. There is no Postgres or
  second container.

`drop update <id|slug>` re-reads `drop.json`, builds the image while the old
container is still running, then stops it and starts the new one. The pause is
the container restart plus the health check, usually a few seconds. A failed
build leaves the old service running. `drop restart` is a hard restart: it
stops first and rebuilds while the service is down; use it when the config has
not changed.

Workers run inside the same container: a worker thread, a child process with
its own supervisor, or a queue in the same process. There is one container per
service, so a separate worker container is not supported. WebSocket and SSE
already pass through the proxy; an update drops those connections.

A minimal React plus server image:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./
ENV NODE_ENV=production DB=/data/app.sqlite
CMD ["node", "server.js"]
```

Containers are named `drop-<slug>`, run rootless without `--privileged`,
`--network host` or a podman socket, and publish only on `127.0.0.1` at a random
port chosen by the manager. They are labeled `nit.drop.id=<id>`. The proxy
never trusts the port stored in `entry.json`; it asks podman for the live
mapping. Containers survive a nit-gui restart and are reconnected or started on
boot.

`/nit/d/<slug>/...` proxies every method, WebSocket upgrade, SSE stream and
API request to the container. The proxy sets `X-Forwarded-Prefix` and
`X-Forwarded-Proto`, forces the upstream `Host` to loopback, and removes
`nit_gate`, `Authorization` and `X-Nit-*` headers. Cookies set by a service are
scoped to its own `/d/<slug>/` path. The application must be prefix-aware:
absolute links such as `/assets/app.js` are not rewritten. Use relative URLs,
a configured base path or `X-Forwarded-Prefix`.

For a React or Vite build this means a relative base (`base: "./"`) and relative
API calls, or a base path baked for one fixed slug. Renaming the slug does not
rewrite asset URLs inside the build.

A private service requires `nit_gate` and returns 404 to anonymous visitors. A
public service is anonymous. Write operations still require the manager cookie
and the origin guard. `drop rm` stops and removes the container; the source
directory is never deleted. `--expire 2w` stops and removes the container when
the entry expires. Logs are available through `drop logs` (podman's `k8s-file`
driver, 10 MB cap per container).

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
  Each row shows a mini preview: an image thumbnail, a scaled sandboxed frame
  for HTML pages, or the first lines of a text file. Service rows show the live
  container status.
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
- HTML previews run in a scaled iframe with `sandbox="allow-scripts"` and no
  `allow-same-origin`, so a previewed page cannot read the manager DOM or its
  cookies. Drop responses allow framing by the same origin only
  (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`); public pages keep
  their opaque sandbox origin and cannot frame other drops.
- Services run as rootless podman containers with `no-new-privileges` and all
  capabilities dropped. They can still reach the network and run arbitrary code
  from the directory, so publish only trusted code. A Containerfile build runs
  as your user. Do not point `drop service` at your home directory or at the
  drop store.
- Service volumes are ordinary host directories under `NIT_DROP_VOLUMES`; anyone
  who can read that path can read the database. They are not deleted with the
  entry. `env_file` stays in the service directory and is passed to podman; it is
  not baked into the image or written to logs.
- The browser is still on one origin with nit-gui. A service opened by the
  logged-in owner can call the nit API from its JavaScript. Removing cookies
  from the proxy protects the container process, not the browser. The path-based
  Funnel URL does not permit a separate origin; treat public services as trusted
  code.
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
| `NIT_DROP_PODMAN` | `podman` | Podman binary or wrapper used for services and logs. |
| `NIT_DROP_VOLUMES` | `~/.local/share/nit-gui/drop-volumes` | Host directory for service volumes, one `0700` folder per entry. |
| `NIT_DROP_BASE_PATH` | empty | Prefix passed to service containers as `NIT_DROP_BASE_PATH`. |
| `DROP_PUBLIC_BASE` | `https://frankfurt.tailf358cb.ts.net/nit/d/` | Base used by `bin/drop`. |

Rootless podman needs a working user session. If `podman info` reports a stale
pause process, repair the user systemd session or point `NIT_DROP_PODMAN` at a
wrapper that runs podman with a writable `XDG_RUNTIME_DIR` and
`--cgroup-manager=cgroupfs`.
