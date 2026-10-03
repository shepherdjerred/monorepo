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

## Lobby and game identity

LCU exposes a lobby's `partyId` while the lobby exists and a real `gameId` only
once the game is in progress, and the in-progress session carries no lobby
identity — the two facts never appear in the same payload, and no field is
shared between them. The lobby is also the only place the complete roster
appears, including bots and custom teams that Riot's spectator API omits.

A process watching the transition is therefore the only party that can tie the
two together. The client remembers the current lobby, claims it for the next
game that starts, and stamps the result onto the envelope's `lobbyId` for
observations whose own payload has none. Both halves live in the SQLite outbox,
so the join survives a restart between champion select and the game. When the
join is recorded the client sends the in-game session once more, stamped: the
first copy left before the join existed, and an unchanged session is not
otherwise resent, so without it the server would not learn the game's lobby
until post-game — after prematch needed it. The backend README describes how
prematch uses it.

Each game records one outcome, which the first attempt decides: a game's roster
cannot change identity partway through. "No lobby was observed" is recorded as
such rather than retried, since a client that started mid-game will never see
the lobby that is already gone. A remembered lobby stops being eligible after
fifteen minutes, because a stale key would attach one game's roster to another,
which is worse than having no key at all.

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
