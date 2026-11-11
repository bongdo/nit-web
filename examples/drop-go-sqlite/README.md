# drop-go-sqlite

A small Go service with a React page built by Vite and SQLite on a drop volume.
It exists as a working example of the full stack: API, built frontend, SQLite,
`drop update` and persistent data.

```sh
drop service examples/drop-go-sqlite --slug notes
drop update notes
```

- `GET /api/health` — readiness for drop.
- `GET /api/notes`, `POST /api/notes`, `DELETE /api/notes/{id}` — JSON API.
- The page is served from `web/dist`; Vite uses `base: "./"` so the slug can
  change without rebuilding the asset URLs.
- SQLite lives at `/data/app.db`, which is the entry's volume. `drop rm` keeps
  the volume; delete `~/.local/share/nit-gui/drop-volumes/<id>` to remove it.
