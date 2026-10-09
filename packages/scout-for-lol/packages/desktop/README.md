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

The League client puts chat credentials in payloads the client does collect —
`multiUserChatPassword` and `mucJwtDto` in end-of-game blocks, a chat room
password in champion select, a lobby password in a custom game's session.
`ObservationEnvelope::new` removes every key whose name contains one of the
shared contract's `credentialKeyFragments` (`protocol.contract.json`), at any
depth, so none is queued, persisted, or sent. Fragments are specific
(`accesstoken`, not `token`) because champion mastery's `tokensEarned` is
gameplay data.
Clash capture includes check-in, invitations, tournament state, rewards, and
history; mastery capture preserves the client's season-milestone fields.

Each profile endpoint is read on its own: one that fails, as the Clash
endpoints do outside a tournament window, records its `lcu_read` diagnostic
and the rest still run. A pass fails when no endpoint returned anything (a 404
returns nothing), or when the outbox can't keep what was read. Reads share a
20-second budget, so a stalled League client can't hold the pass for every
read's timeout. Reads past the budget wait for the next pass and record a
`profile_pass` diagnostic. After the
fixed Clash endpoints, the pass follows the player's own roster ID to the
resources only an ID reaches: that roster, its record, its bracket, and its
tournament (`collect_clash_details`). Invited rosters are not followed. The
server keeps one snapshot per player and resource, so a second roster would
replace the player's own.
The field names those IDs come from are the best available description of the
League client's Clash payloads, written before a Clash window could confirm
them. A name that never appears reads nothing. Every ID is parsed to its own
shape before it reaches a path, as a game ID is.

## Player identity

Every player ID the client reads is a League-client UUID, not the Riot API
PUUID the server stores, and the client sends it unchanged. The server
translates it; the backend README ("Scout Client player identity") describes
how. The client only has to keep reporting the account profile, whose
`gameName#tagLine` is what lets the server resolve its own player.

## Finished games

The match-history list holds only the local player for each game, so a
finished game's post-game bundle carries the full game instead:
`/lol-match-history/v1/games/{gameId}`, with every participant and their stats,
plus `/game-timelines/{gameId}`, its per-minute frames and objective events.
Both exist for games Riot's API never returns — customs of any size, Arena,
ARAM Mayhem — which is what lets the server treat such a game as it would a
Riot one. The game ID in each path is parsed from a League-client payload as a
positive integer (`GameId`); `LcuResource` is the only way a path takes a
variable segment.

The bundle waits, still pending in the outbox, until the League client serves
the full game; the one-player list row is never sent in its place. A missing
timeline doesn't hold the game back. Each read records a `read_post_game`
diagnostic with its outcome and no identifiers.

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

The window renders with wgpu. The glow renderer unwraps `make_current` every
frame on Windows and panicked when the GL context was invalidated by
sleep/resume, a driver reset, or a display change. If wgpu can't start, the
window falls back to glow and records a `start_renderer` warning.

Errors and crashes are also reported to Bugsink once a DSN is configured in
`scout_client_core::reporting`; until then the reporter is not installed and
everything stays on the machine. Only `Error` and `Critical` records are sent,
and they are the same allow-listed records, so nothing leaves that the local log
does not already hold.
