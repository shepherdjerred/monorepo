# Scout Client

Pure-Rust `egui` desktop observer for League of Legends. The application is a
background tray process with a small native status, pairing, settings, and
diagnostics window. It reads only the local gameplay endpoints declared in
`scout-client-core::lcu::LcuEndpoint` and persists outbound observations in a
SQLite outbox before delivery. Custom and duel games are recognized from an
exact observed roster; League gameflow then advances the bound game without
asking an organizer to provision a special lobby.

Windows x86-64 is the primary distribution target. macOS is supported for
development and regular use. The Settings page can register the current binary
for per-user start at login on either platform.

```bash
mise exec -- cargo run --package scout-client-app
mise exec -- cargo run --package scout-client-app -- --background
bun run test
bun run lint
```

Preview packages target `https://beta.scout-for-lol.com`, where the ingestion
flag is rolled out. Use `--server=http://127.0.0.1:<port>` for a local backend;
an explicit server is also retained in start-at-login registration. Remote
origins must use HTTPS. `bun run package` builds the platform-native installer
from the workspace metadata and pinned repository toolchain.

The Riot lockfile credential stays local and is redacted by construction. The
client is not an arbitrary LCU proxy and does not collect chat, friends, social,
store, or purchase data. Device credentials use the OS credential store. Raw
observations survive transient network failures in the local SQLite outbox.
Clash capture includes check-in, invitations, tournament state, rewards, and
history; mastery capture preserves the client's season-milestone fields.

## Diagnostics

The release binary is a GUI-subsystem process with no console, so it writes
rotating JSONL to `logs/` under its per-user data directory
(`%LOCALAPPDATA%\Scout\Scout Client\data` on Windows). Files roll at 25 MiB and
are kept for seven days. The Diagnostics page shows recent events and counters,
opens that folder, and copies a shareable bundle.

Records carry an allow-list — level, category, operation, outcome, HTTP status,
duration, size, and a bounded `detail` — so a credential, PUUID or filesystem
path is not representable in one rather than merely filtered out of it. Adding
a field is the only way to widen what a record can hold.

Errors and crashes are also reported to Bugsink once a DSN is configured in
`scout_client_core::reporting`; until then the reporter is not installed and
everything stays on the machine. Only `Error` and `Critical` records are sent,
and they are the same allow-listed records, so nothing leaves that the local log
does not already hold.
