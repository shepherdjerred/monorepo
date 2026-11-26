# tasknotes-web

Browser client for the Facet sync server. It speaks `POST /api/v1/sync` and
covers Inbox, Today, Upcoming, Completed, projects, labels, quick add,
completion, and the task inspector.

## Run

Start the server. With `DATABASE_URL` unset it keeps an in-memory workspace:

```bash
bun run --cwd packages/tasknotes-server dev
```

Then start the web app:

```bash
bun run --cwd packages/tasknotes-web dev
```

Open the printed URL. The dev server proxies `/api` to
`http://127.0.0.1:3000` (override with `TASKNOTES_SERVER_ORIGIN`). Leave the
token blank when the server has no `AUTH_TOKEN`. Otherwise paste the owner
token or an `fct_*` token. "Remember on this browser" stores that token in
`localStorage` on this machine.

Dev and preview allow hosts ending in `.ts.net`. Tailscale Serve can publish
port 4187 on the tailnet. Leave the server origin at `http://127.0.0.1:3000`
so the browser calls `/api` on that host and Vite proxies it locally.

## Not in this package

Kanban, recurrence editing, comments, attachments, reminders, saved filters,
offline sync, and homelab hosting.
