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

History, profile and Clash collection use independent workers, outside the
gameflow/end-screen loop. Their scheduling cadences are 30, 60 and 10 seconds;
a running pass finishes before another starts. Account switches clear each
worker's deduplication cache. Started gameflow sessions also emit a heartbeat
every 30 seconds, so unchanged rosters remain fresh on the server.

Clash overview and entity reads have separate 20-second budgets. Reads rotate
between passes so an unavailable endpoint cannot starve the rest. The entity
pass follows observed roster, bracket and tournament references, including
opponents and invited rosters. The player's roster retains its primary
resource name; additional entities use `resource:id`, so they cannot replace
one another. Each failed endpoint records a diagnostic and leaves the other
reads eligible.
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

The history worker scans the newest page and one overlapping older page per
pass, checkpointed by signed-in account. An exhausted scan restarts daily.
Gameflow, EOG, Clash and local replay references also persist game hints, so a
game need not appear in the newest history page to be recovered. Full game
reads must agree with the requested ID, platform and observer before becoming
qualified recovery work.

The first history-list snapshot carries any validated witnessed completion,
using the same observer, platform and timing checks as the full result. A
background history scan therefore cannot label an already witnessed live
completion as historical before the enriched result arrives. Unwitnessed
history retains its historical provenance; server eligibility is permanent.

Malformed history pages defer their scan checkpoint while already discovered
games continue recovering. A validated full game is cached in SQLite before
enqueueing its result, so a crash or enqueue failure can retry the captured
bytes even if the LCU endpoint later stops serving the game.

Result and timeline collection have separate durable checkpoints. Full history
is sent even without EOG or timing; a list row remains discovery evidence.
Missing artifacts retry with bounded backoff and no attempt cutoff. Recovery
checks four due games per pass and preserves progress across restart. A failed
game does not prevent the others from being collected. The backend can retain
a normalized scoreboard even when these fragments cannot form a complete
Match-V5 document. After pairing, the approval page links to recovered games.

Existing local replay files are offered independently. Temporary server
deferrals remain retryable, with backoff up to one hour. An outbox migration
reoffers files older builds abandoned for missing evidence. Permanent server
validation rejections remain terminal. The client does not download replays.

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

Transient lobby joins, EOG fragments and timing are scoped to the signed-in
observer. Upgrading preserves older unqualified rows in separate SQLite tables;
they cannot be attributed safely and do not participate in new joins. History
recovery itself is keyed by observer, platform and game ID. EOG enrichment must
also agree with the full game's creation time and any stated platform.

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

The window renders with glow. On Windows both of egui's renderers panic when
the GPU context is lost: glow when sleep/resume, a driver reset or a display
change invalidates it, and wgpu when it can no longer write a buffer, which
happened within a minute on a hybrid-GPU machine. So the window is not trusted
to stay up. `main` owns the collector and catches a window panic. It then stops
the collector and waits for it, so only one client ever reads the outbox, and
relaunches the client with the same arguments. Nothing is lost, because the
outbox is on disk. A `window_crash` diagnostic records each crash. After three
crashes, each within ten minutes of its start, the client stops relaunching
(`--quick-crashes` carries the count).

Errors and crashes are also reported to Bugsink once a DSN is configured in
`scout_client_core::reporting`; until then the reporter is not installed and
everything stays on the machine. Only `Error` and `Critical` records are sent,
and they are the same allow-listed records, so nothing leaves that the local log
does not already hold.
