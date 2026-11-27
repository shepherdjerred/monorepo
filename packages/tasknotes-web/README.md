# Facet for Web

Use [Facet on the tailnet](https://tasknotes.tailnet-1a49.ts.net/) to open the
same workspace as the native Facet apps. Enter your access token to connect.
Use **Advanced connection settings** for a custom server, or **Continue
locally** to start a workspace in your browser. Connect a local workspace from
Settings when you’re ready to sync its tasks.

Today, Inbox, Upcoming, projects, labels, saved filters, and tasks have
bookmarkable URLs. Press **Q** for Quick Add or **/** to search the workspace.
On mobile, Browse contains projects and other collections.

## Development

Start the server on port 3000. Unset `DATABASE_URL` and `AUTH_TOKEN` for a
disposable in-memory workspace that accepts a blank token.

```bash
bun run --cwd packages/tasknotes-server dev
bun run --cwd packages/tasknotes-web dev
```

Open the URL Vite prints. The development server proxies `/api` to
`http://127.0.0.1:3000`. Set `TASKNOTES_SERVER_ORIGIN` to point the proxy at a
different server. The cluster image serves the built client and API from the
same tailnet host.

```bash
bun run --cwd packages/tasknotes-web test
bun run --cwd packages/tasknotes-web test:e2e
```

Playwright builds the production client and starts a private in-memory
TaskNotes server on a free loopback port.

## Data on this device

The web app uses the Facet wire protocol and `POST /api/v1/sync`. IndexedDB
stores each workspace’s last synced state, drafts, and pending commands. The
queue retries after a connection returns while Facet is open. The service
worker caches the application files for offline launch. Private attachments
are requested from the server with the active access token.

The browser and server use the same recurrence calculator from
`@shepherdjerred/facet-protocol/recurrence` to advance repeating tasks.

Sign-out locks the local workspace and clears its token. Use **Remove local
data** from Settings to delete the workspace’s browser copy, including
pending edits. For shared browsers, keep **Remember on this browser** off
and remove local data before leaving the device.
