# Media

Household media requests and automation, with Plex for playback and qBittorrent
for transfers. The application owns its PostgreSQL data; recurring orchestration
belongs to the central `packages/temporal` service.

Implementation and rollout acceptance are tracked in
[AI-300](https://tracker.tailnet-1a49.ts.net/issues/AI-300). This package does not
automatically take ownership of existing library files or torrents.

## Development

Run dependency installation and generation from the repository root:

```sh
bun install --frozen-lockfile
bunx turbo run generate --filter=@shepherdjerred/media
bunx turbo run build typecheck test lint --filter=@shepherdjerred/media
```

The integration tests create an isolated local PostgreSQL cluster and apply the
committed migrations. They require the repository's PostgreSQL tools on `PATH`;
they do not use a developer or production database. Filesystem tests use
temporary directories and Python 3's `fcntl` advisory locks, including subprocess
termination to exercise recovery.

Media inspection tests also require `ffmpeg` and `ffprobe` on `PATH`; the CI and
Temporal images install them. The repository's mise configuration supplies the
upstream `7zz` command used for bounded subtitle archive extraction.

The API runs with `bun run --cwd packages/media start` after building the client.
Bootstrap credentials and endpoints are validated by
[`BootstrapSchema`](src/infrastructure/config.ts). Obtain credentials through the
repository's password-manager wrappers. Runtime behavior comes from typed
configuration and the managed `media` flag namespace. The database migration
command is `bun run --cwd packages/media migrate:deploy`; set `DATABASE_URL` only
to the intended application database.

## Restore preparation command

`bun scripts/restore-observe.ts --recovery-id <UUID> --expected-epoch <N> --reason <text>`
requires an explicit `DATABASE_URL`. Run it against the restored database while
the API and both media worker roles are stopped and schedules remain paused,
before allowing any worker to reconnect. Inspect the restored
`MediaRuntimeState.recoveryEpoch` to choose `N`; do not assume a backup contains
observe mode. The command atomically sets observe mode, clears ownership
confirmation, advances the recovery epoch, and records an idempotent receipt.
It prints only that receipt. Reusing the same recovery identity and input is safe;
conflicting input or a changed runtime fails without mutation.

Verify the returned epoch and `mode: observe` before restarting workers for
inspection. Existing acquisition and notification birth epochs cannot authorize
effects in the new epoch. This command does not transfer ownership, activate
schedules, repair files, or assert that a restored database matches external
state. Reconcile inventory and effect journals before a separately reviewed
ownership transfer. Keep acquisition, cleanup, quarantine, and purge gates closed
through that review.

## Bounded reconciliation

Whole-series requests commit a parent claim and outbox entry; Temporal projects
episode coverage in pages of 25. Parent cancellation immediately removes inherited
authorization, even before descendant projections finish. Direct episode requests
and overlapping parents retain their own claims. Catalog refresh stores episode
runtime, air date, and original language from TMDB; pending metadata is explicit.
Future episodes are expanded from later catalog refreshes only for monitored
requests, and acquisition waits until a known future air date has passed.

Download recovery queries the exact coordinator and acquisition Workflow identities.
Only observed terminal runs permit takeover; missing or active child history holds
ambiguous submissions. Stable recovery keys preserve the existing acquisition and
its external-effect journals. Inventory scans record Plex observations in bounded
pages without claiming foreign files. Missing-path diagnostics require both
configured libraries to finish enumeration. Current provider adapters have no
verified recent-release feed; their durable feed status reports
`unsupported_recent_feed`, while six-hour due searches remain separate.

## Package boundaries

| Directory            | Responsibility                                                                          |
| -------------------- | --------------------------------------------------------------------------------------- |
| `src/shared`         | Validated API contracts shared with the browser                                         |
| `src/domain`         | Pure quality, request, subtitle, seeding, and retention decisions                       |
| `src/application`    | Authentication and application interfaces                                               |
| `src/infrastructure` | PostgreSQL transactions, encrypted credentials, and adapters for application interfaces |
| `src/integrations`   | External service and provider clients                                                   |
| `src/filesystem`     | Journaled file publication and removal operations                                       |
| `src/automation`     | Durable Activity implementations and PostgreSQL reconciliation                          |
| `src/migration`      | Read-only source-profile validation, semantic evidence, and adoption reports            |
| `src/server`         | HTTP boundary and process bootstrap                                                     |
| `src/client`         | Household web interface                                                                 |

`./contract`, `./automation`, `./automation/network`, `./automation/files`,
`./domain/*`, `./integrations/*`, and `./filesystem/*` are the public package
subpaths. Domain policies do no I/O. Browser code must not import
privileged application or filesystem modules.

## Effect and ownership contracts

Requests change desired state in a database transaction that also records an
operation and outbox command. Idempotency keys identify retried commands;
expected versions reject conflicting edits. Workflow delivery must use stable
operation identities because delivery and execution can be repeated.

A release acquisition and a torrent's seeding obligation have independent
lifetimes. Library availability does not authorize source deletion. Quality
profiles have immutable version snapshots, and the database permits only one
current asset for a media item and edition.

File operations stage and verify bytes before acquiring the final publication
lock. The caller supplies an authoritative authorization check under that lock.
An upgrade preserves a rollback copy and atomically replaces the visible path.
The operation journal permits reconciliation after process termination; a
database transaction alone cannot make a filesystem mutation atomic.

Acquisition, source cleanup, quarantine, and permanent purge have separate
configuration gates, all disabled by default. Each effect still requires current
ownership, intent, and policy checks. Tests against injected service responses
establish adapter behavior, not live tracker compatibility or production
acceptance.

## Runtime boundaries

The [API](src/server/index.ts) commits intent and an outbox row together. The
[outbox dispatcher](src/automation/store.ts) starts workflows using stable IDs;
a failed Temporal connection leaves the command available for later delivery.
The UI reads PostgreSQL projections rather than querying workflow histories.

[Temporal workflows](../temporal/src/workflows/media.ts) carry identifiers.
Provider credentials and candidate payloads stay in PostgreSQL and Activity
processes. The network worker owns authenticated external calls. The file worker
has read-only download access and writable library access, without provider
credentials. Their [deployment](../homelab/src/cdk8s/src/resources/media/application/workers.ts)
keeps these mounts and credentials separate. NetworkPolicy declarations require
an enforcing CNI; they alone do not establish packet isolation.

[Runtime state](src/automation/runtime.ts), current intent generations, effect
gates, and ownership jointly authorize effects. A restored database must enter
observation mode with a new recovery epoch before workers reconnect. Restoring
an active database unchanged does not establish that authority.

Library control directories hold staging, rollback, and quarantine data on the
destination filesystem. The [file runtime](src/automation/network.ts) requires
Plex exclusion evidence for the current recovery epoch before using nested
control directories. Unknown watch state, notification outcomes, or ownership
protects files. Quarantine retains bytes and therefore does not reclaim space.

## Resolved profile evidence

The [profile importer](src/migration/profile-import.ts) validates captured
Radarr/Sonarr profiles and records source versions and stable snapshot hashes.
It preserves quality groups, cutoffs, custom-format definitions and scores.
Reports distinguish live source configuration from desired profile names;
they do not grant file or torrent ownership.

Profiles with a `resolved` snapshot use the source evaluator for candidate
selection, reservation, upgrades, and measured-file publication. Legacy profile
fields remain the compatibility envelope; they do not override the resolved
rules. Profile versions preserve the captured snapshot. Unknown rules,
original-language evidence, or required release metadata protect the candidate.

The production matcher invokes the self-contained
`/opt/media-regex/RegexOracle` executable on Node or Bun. It uses .NET 10.0.11,
explicit `en-US` culture, a 25 ms regex deadline and a 60 second process deadline.
The production image excludes the .NET SDK. Input and output are bounded and
validated through a Node child-process protocol. Matching happens before database
locks; final guards use only exact pattern/input observations. New predicates
without observations protect until evidence is refreshed. Acquisition-referenced
candidate evidence stays immutable.

The source parser currently supports a verified scene-name subset with explicit
year or season numbering, source, resolution, and release group. Ambiguous
markers, anime, site prefixes, and unrecognized edition syntax protect instead
of guessing. File inspection replaces advertised resolution and audio with
measured values. Missing catalog runtime or original-language evidence remains
unknown; no default English track or guessed runtime is introduced.

To produce a repeatable read-only import report from a saved nonsecret snapshot:

```sh
bun scripts/migration-profiles.ts --snapshot src/migration/fixtures/resolved-profiles.json --desired-profile Best
```

For live inventory, use `--recyclarr-reference` with the configured 1Password
field reference. The command reads it in memory through the repository service
account wrapper. Optional `--radarr-url` and `--sonarr-url` accept localhost
port-forward endpoints only. Two consecutive GET-only captures must agree;
the output contains validated profile data, provenance, and desired/live drift.
The command never writes to either application or transfers ownership.

To regenerate regex observations from the sanitized source snapshots and
synthetic release fixtures, run from this package:

```sh
bun scripts/migration-fixtures.ts
```

This uses the repository's .NET SDK and the bounded
[`RegexOracle`](scripts/regex-oracle/RegexOracle.csproj) process. TypeScript and
C# validate the shared [protocol](src/migration/regex-protocol.schema.json).
The command reads committed fixtures and writes the regex evidence fixture;
it does not contact a tracker or modify a live library.
