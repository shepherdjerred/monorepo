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

## qBittorrent integration contract

The adapter targets qBittorrent **5.2.4 / WebAPI 2.15.1**. Its committed
[protocol fixture](src/integrations/fixtures/qbittorrent-5.2.4.json) records
synthetic v1, v2, and hybrid torrents from the pinned runtime image. Session
cookies retain their actual `QBT_SID_<internal-port>` name. Successful adds use
the version's JSON response and are then reconciled against observed full
cryptographic identities. The 40-character qBittorrent API ID is stored
separately; file inventory and removal use that observed ID.

New transfers use category `media`, exactly one `media-<operationUUID>` tag,
one `media-attempt-<attemptUUID>` tag, manual torrent management, and the exact
save path `/downloads/media/<attemptUUID>`. Native ratio and both time limits
must remain unlimited, with action `Stop`. Both configured and effective limits
are observed; drift protects the source instead of automatically fighting
another writer. Limit times are minutes; elapsed seeding time is seconds.
An infinite observed ratio is represented as `{ "kind": "infinite" }`.

These labels route new transfers around the legacy hook; they do not prove
ownership of an existing torrent. Adoption requires an explicit ownership
handoff and quiescing/draining in-flight legacy hook processes before labeling.
An unknown add outcome is reconciled without blindly submitting again, including
after the requesting claim is cancelled.

## Plex exclusion API contract

`@shepherdjerred/media/plex-exclusion` exports the identifier-only maintenance
Activity contracts. `@shepherdjerred/media/automation/plex-exclusion` exports
the network/files runtime factories. Central Temporal workflows execute on
`monorepo-workflows`, with Plex I/O on `media-network` and probe file operations
on `media-files`.

The owner API below requires the normal authenticated session and CSRF header.
POST commands also require an `Idempotency-Key`. The runtime must be in observe
mode, at the reviewed version and recovery epoch, with acquisition effects
quiescent. Preparation does not modify the scanned library.

| Endpoint                                        | Request and result                                                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/plex-exclusion`              | Current runtime mode/version/epoch and the latest 20 runs.                                                     |
| `POST /api/v1/admin/plex-exclusion/prepare`     | `{ "kind": "movies" or "tv", "expectedRuntimeVersion": N }`; returns `runId` and `operationId`.                |
| `GET /api/v1/admin/plex-exclusion/:id`          | Preparation state, exact plan, digest, version, probe checksum, and cleanup review.                            |
| `POST /api/v1/admin/plex-exclusion/:id/execute` | `{ "planDigest": "…", "expectedVersion": N }`; approves that exact prepared plan.                              |
| `POST /api/v1/admin/plex-exclusion/:id/recover` | The same digest/version shape; requires an intervention run and a confirmed terminal prior Temporal execution. |

Read the runtime version, request preparation, then inspect the returned run
until it is `prepared`. Review the exact server/section identity, scanner,
library/control roots, existing and proposed marker contents, synthetic probe
paths, and cleanup policy before submitting its digest/version to `execute`.
Execution preserves existing `.plexignore` lines, adds the reviewed exclusion,
writes two identical valid synthetic videos, and requests a root-scoped scan.
It never scans the hidden control subtree directly.

Scan issuance waits until the whole second after staging or cleanup finishes;
proof rejects any watermark from that completion second or earlier. Proof
requires a newer scan watermark and two complete stable Part inventories,
with the positive probe visible and every control-directory path absent.
HTTP success alone is insufficient. Files are removed using their durable
local journal, hashes, and filesystem identities. A cleanup scan must then show
probe disappearance before a trusted proof is issued. Markers and recovery
evidence remain in the control directory.

Plex's metadata DELETE also deletes media bytes, so the application does not
expose it or empty global library trash. If Plex retains probe metadata, the run
enters `intervention`. Inspect `cleanupReview`: it supplies rating keys, all
observed Part paths, and whether every Part belongs to the synthetic probes.
An unrelated merged Part must remain protected. Resolve the exact retained
entry through a separately reviewed Plex operator action, then call `recover`
with the current run version and original digest. Recovery cleans only the
existing journal's probes and reconciles observations; it does not reissue an
unknown scan or silently reopen an old recovery epoch. A missing or still
running prior workflow blocks recovery. Interrupted preparation with no reviewed
plan requires a new preparation.

The files worker accepts only the dedicated proof record, exact current marker
hashes, and the current recovery epoch. The minute downloads sweep refreshes
topology evidence; a server/section/scanner/root change revokes the proof, and
an attestation older than 15 minutes protects files. Same-epoch activation does
not invalidate an otherwise matching proof. These contracts do not establish
live exclusion: activation requires executing and observing both library proofs
on the actual deployed worker and Plex versions.

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

File operations stage and hash bytes before acquiring database authority locks.
Publication, quarantine, restore, purge, and rollback carry process-local proofs
of file checksums, inode identity, parent directories, and absent destinations.
The final short transaction locks media rows before filesystem paths, rechecks
current authority and those proofs, and never falls back to hashing. Proofs expire
after sixty seconds and are regenerated on retries; only journaled filesystem
mutations can advance their inode metadata. Keep can commit while hashing and
invalidate the pending effect before its final authorization.
An upgrade preserves a rollback copy and atomically replaces the visible path.
The operation journal permits reconciliation after process termination; a
database transaction alone cannot make a filesystem mutation atomic.

Superseded videos and archived sidecars remain recoverable for seven days after
their successor is verified in Plex. A separate durable cleanup checks the exact
archive journal, current playable coverage, ownership, recovery epoch, active
holds, and unresolved recovery dependencies before purging. Later upgrades do not
restart an older version's deadline. Interrupted purges resume only from their
matching journals; unexplained missing files remain protected. Failed publication
restores predecessors as importing, then rescans Plex and verifies every covered
title before making them available. A retry resumes this verification without
submitting the failed acquisition again.

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

The source parser supports a verified scene-name subset and captured Sonarr
anime forms with bracketed groups, absolute numbering, checksums, explicit
quality details, and `v2` revisions. Absolute episode coverage still requires
an owner-provided canonical numbering map. Sonarr's resolution-only anime
classification is preserved as source policy evidence; it does not establish
measured provenance. Unknown audio stays unknown. Ambiguous markers, unsupported
anime forms, site prefixes, and unrecognized editions protect instead of
guessing. File inspection replaces advertised resolution and audio with
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

## Migration capture and review

The [capture adapters](src/migration/capture/manager-capture.ts) and their bounded
HTTP, pagination, wire-validation, and snapshot-validation helpers live in
`src/migration/capture`. Normalization, catalog discovery, and persisted review
remain in `src/migration`.

The migration inventory command performs bounded read-only Radarr, Sonarr,
Seerr (including Overseerr/Jellyseerr), Bazarr, and qBittorrent captures. It reads credentials
through the repository's 1Password wrapper;
the source instance identifier is an opaque SHA-256 identifier assigned by the
operator, never an endpoint or credential. Capture output whitelists identities,
file coverage, local paths, quality assignments, and monitoring state. It omits
contact details, provider configuration, private URLs, and credentials.

```sh
bun scripts/migration-inventory.ts --capture sonarr --base-url "$MEDIA_SOURCE_URL" --api-key-reference "$MEDIA_SOURCE_KEY_REFERENCE" --instance-id "$MEDIA_SOURCE_INSTANCE_HASH"
bun scripts/migration-inventory.ts --capture qbittorrent --base-url "$MEDIA_SOURCE_URL" --username-reference "$MEDIA_USERNAME_REFERENCE" --password-reference "$MEDIA_PASSWORD_REFERENCE" --instance-id "$MEDIA_SOURCE_INSTANCE_HASH"
bun scripts/migration-inventory.ts --snapshot capture.json --targets targets.json --baseline previous-capture.json
```

The output contains `snapshot`, a protected normalization report, and an optional
final delta. Save the `snapshot` object for subsequent CLI comparisons; the owner
UI also accepts the complete command output. Two consecutive observations must
agree. Limits are 500 total GETs, 50,000 records, and 24 MiB per capture pass or
uploaded snapshot. Missing records establish deletion only when both captures
are complete and stable. Unknown checksums, identities, requester mappings,
subtitle provenance, and overlapping files remain protected. Identity hashes
use locale-independent ordering.

The qBittorrent capture adapter retains separate full v1/v2 infohashes and the
40-character API ID, configured and effective seed limits, ratio state, paths,
tags, and categories. It never treats a category or path as ownership proof.
Changing torrent observations remain protected. Seerr capture verifies permission
to inventory all requests and preserves source requester IDs; it never equates a
display name or source `plexId` with a global Plex account. Bazarr capture retains
per-language forced, hearing-impaired and audio inclusion/exclusion settings,
cutoffs, embedded track provenance, and hashed text constraints. Its numeric
manager IDs remain unbound until an exact source-instance association is proved.

Owners can upload and review captures at `/admin/migration`. The API saves
immutable capture records and report evidence. Approval binds capture/report
hashes, recovery epoch, runtime version, and expected proposal version. It only
records review: no manager pause, filesystem operation, torrent change, ownership
transfer, or runtime activation occurs. The combined-report flow binds an immutable
set of capture IDs/hashes, source instances, cross-source torrent identity evidence,
explicit eligible selections, and runtime epoch/version. Missing source roles,
changing captures, unknown identities, or overlapping files protect the report.
An approved combined selection still grants no ownership: physical files require
fresh trusted mount/checksum and manager-quiescence proof in the separate handoff
application. Proposed root mappings preserve both original manager paths and
canonical worker roots; they remain explicitly unverified until that proof exists.

For a fresh database, the owner review offers bounded catalog discovery (ten root
identities per step). This resolves exact TMDB identities or unique TVDB/IMDb
external-ID lookups, rejects contradictory identities, and resumes from an explicit
cursor. It creates catalog metadata only. TV episode projection uses the existing
durable catalog workflow; partial projection cannot make source episodes eligible.
Regenerate the combined report after projection completes. Unmatched source episode
numbering stays protected; no title or numbering guesses are imported.

Owner endpoints under `/api/v1/admin/migration` expose capture upload/detail/review,
`captures/:id/discover`, and `bundles` create/list/detail/review. Every mutation uses
the authenticated owner session and CSRF protection; review commands also use the
normal idempotency key and expected-version checks. Capture and bundle evidence is
immutable in PostgreSQL. Single-source approval is never an activation input.

For schema verification, supply the disposable PostgreSQL datasource explicitly:

```sh
DATABASE_URL="$MEDIA_TEST_DATABASE_URL" bunx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code
```

Require exit 0 **and** the explicit empty-migration output. Verify the procedure
with a deliberately different schema, which must return exit 2 and a nonempty
diff. Prisma's schema-only diff can silently exit without output when no
datasource is configured; see Tracker AI-305.
