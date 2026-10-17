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

## Ownership handoff API contract

The owner-only handoff API accepts stored immutable migration bundle reviews.
Normal session authentication, CSRF protection, and an `Idempotency-Key` apply to
commands. The application never accepts caller assertions of stopped managers,
verified files, or trusted mount identities.

| Endpoint                                | Contract                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/admin/handoffs`           | `PrepareHandoffSchema`: exact bundle/review hashes and versions, runtime epoch/version, explicit provenance selection, and immutable imported profile bindings. Returns an operation and handoff ID.                 |
| `GET /api/v1/admin/handoffs/:id`        | Current preparation state, exact selected scope, complete proof plan/hash, expiry, and eventual receipt ID.                                                                                                          |
| `POST /api/v1/admin/handoffs/:id/apply` | `ApplyHandoffSchema`: exact prepared plan hash/version and runtime epoch/version, plus explicit acknowledgements of protected legacy sources and household recovery holds. Queues a fresh proof and apply operation. |

Preparation authorizes observation only. File hashing and probing run on
`media-files`; a concurrent Temporal activity refreshes network evidence every
30 seconds on `media-network`. Apply hashes again, compares the exact reviewed
identity evidence, and checks current owner authority under the final database
locks. Video content remains unchanged. A durable receipt makes a committed
apply idempotent after an interrupted response.

Each batch covers at most 25 physical files and 100 canonical media items.
`activation: "activate"` changes the reviewed observe runtime to active at its
existing recovery epoch. Later `activation: "extend"` batches require current
active authority and a newly reviewed exact runtime version. Explicit selected
episodes may use an approved canonical series scope; unrelated or ambiguous
items remain unowned. No previous acquisition or notification birth epoch is
rewritten.

Effects also require a fresh trusted legacy-writer lease and current per-record
epochs. Minute reconciliation refreshes the lease and observed worker storage
bindings. Resumed writers or changed PVC/subpath identities revoke authority
when observed; expired evidence protects effects when observation fails. A
replacement files Pod on the same verified storage requires a fresh binding.

Whole-media requests with exact current Plex account access can be adopted;
whole-series requests retain future episode monitoring through bounded coverage
expansion. Managed Home profiles and ambiguous or partial requests remain
protected. Explicitly selected legacy sidecars and embedded tracks can be adopted
with exact source, video, shared-episode coverage, and fresh filesystem evidence;
ownership does not accept their subtitle quality. Unsupported policy semantics,
unbound manager instances, and unselected neighboring files remain protected. Legacy
torrents are recorded as unowned obligations; this API does not change their
paths, tags, cleanup authority, or assert that legacy hooks have drained.

Every adopted physical item retains a separate household recovery hold.
Checksums cannot reconstruct lost post-backup requesters, Keep actions, or pins.
Ordinary Keep/unpin commands cannot release that hold. The explicit recovery
review below reconstructs present household intent; it does not prove that a
backup contained every past request. Reviewed permanent retirement of deleted
legacy controllers remains a separate contract; absent controllers currently
protect rather than prove quiescence.

## Recovery reconciliation API

The `/recovery` interface shows owners protected titles and household reviews.
Owners select media to prepare a review; shared physical files expand the scope
to all covered episodes. Independent accounts sign in and declare retain/request,
Keep for a stated period, or no longer request for their applicable titles. The
owner may declare for an exactly mapped managed Plex Home profile; the immutable
response records both actor and subject. Members never receive another person's
roster, excluded titles, source requester identity or declarations.
Declarations are immutable and **pending** until the owner applies the exact
review. An immediate ordinary Keep/pin remains available and invalidates a stale
review instead of releasing the system hold.

`shared/recovery.ts` defines the request and response schemas:

| Route                                         | Contract                                                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/recovery`                        | Accessible reviews; owners also receive active recovery holds.                                                                                             |
| `POST /api/v1/recovery/reviews`               | Owner prepares up to 100 media items with `PrepareRecoverySchema`.                                                                                         |
| `GET /api/v1/recovery/reviews/:id`            | Owner sees exact scope, outstanding respondents, pins, blockers and responses. Members see only currently permitted titles and their own declaration.      |
| `POST /api/v1/recovery/reviews/:id/responses` | Self declaration, or current owner declaration for an exact managed subject, using `RespondRecoverySchema` and the subject's exact claim acknowledgements. |
| `POST /api/v1/recovery/reviews/:id/release`   | Current owner confirms household completeness, existing pins and the limits of lost history using `ReleaseRecoverySchema`.                                 |

Writes require the authenticated session, CSRF and an idempotency key. Release
compares the reviewed scope and response hashes under sorted media, effective
root-request, runtime, hold, identity and review locks. Versions, root coverage,
exclusions, physical coverage/checksums, personal holds and authority must still
match. Only the listed holds are released, with an immutable receipt. The same
transaction applies the declarations, invalidates old retention authorization,
preserves restoration manifests and clears cached watch evidence. Existing
personal pins remain intact. Asset ownership and old acquisition/delivery birth
epochs are never renewed by this flow.

Fresh denial is evaluated per person and selected title. A person with no
relevant current or historical request/personal hold need not declare for that
inaccessible title. Unknown access never counts as denial; a relevant old claim
keeps the person in scope even after access revocation.

Completed series/season requests can be reconciled one complete physical group
at a time. Only selected leaf declarations change: root future-episode settings,
outside claims, pins and authority epochs remain unchanged. A negative leaf
declaration persists through later root projection. Incomplete root projection
remains protected. Old immutable reviews retain their original v1 meaning.

The owner can associate a captured legacy requester with an exact household
identity through `GET`/`POST /api/v1/admin/legacy-requester-bindings`. This
versioned, owner-declared association grants no demand or ownership. A fresh
review binds capture and record hashes, binding revisions and selected leaves;
each subject explicitly acknowledges that evidence. Outside claim coverage
remains unresolved until separately reviewed.

Retention and final file removal recheck later captured claims. An unaccounted
claim reopens the affected household hold and invalidates the previous warning
and grace period, while preserving any quarantine manifest for recovery.
Historical accounting covers only its exact capture, record, selected leaves
and recovery epoch; a later capture requires fresh review.

Silence, unknown identity or coordinates, unresolved relevant migration claims,
and stale Plex access keep protection in place. Each respondent's scoped access must have been
verified within five minutes of release. Unrelated protected legacy torrent or
subtitle records do not block household review; their own ownership guards
remain independent. Reviews expire after seven days; changes require a new
review and fresh declarations. Quarantined Plex 404 responses remain unknown
watch state and cannot be overridden here. Normal cleanup still requires fresh
watch evidence, personal notification receipts and the normal grace period.

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

## Notification contracts

Verified publication records per-item history and batches deliveries by acquisition,
recipient, channel, and first availability versus upgrade. Upgrades and completed
removals require recipient opt-in. Subtitle notifications bind the installed track
to the exact current video asset/version and requested language. Shared Discord
announcements contain availability or upgrade titles only; they cannot satisfy a
personal removal warning.

Each send has a durable attempt identity, keyed recipient fingerprint, and immutable
birth recovery epoch. Unknown outcomes are never resent automatically. The notification
workflow makes two bounded receipt observations after acceptance; retention additionally
refreshes exact personal receipts before authorizing removal. A bounce or unknown
receipt protects the files. Postal receipt reads validate the original attempt tag;
Discord reads validate the bot identity, message nonce, channel, and recipient.

Retention repeats bounded watch, playback, and personal receipt observations while
one files Activity verifies content, waiting twenty seconds between observations.
After hashing, that Activity
may wait up to thirty seconds without database or path locks for fresh authority;
it retains the same process-local file proof. Final effects still require evidence
no older than sixty seconds and unchanged file identity, intent, ownership, and
holds. Provider failure or cancellation stops the effect and records an operation
requiring reconciliation; uncertain file effects are not blindly retried.

Authenticated `POST /api/v1/notifications/:id/retry` accepts `expectedVersion` only
for the recipient's confirmed rejection or bounce, with a one-minute delay and three
attempt maximum. Prior attempts remain journaled; a new acceptance starts a fresh
seven-day warning grace. `POST /api/v1/notifications/:id/reconcile` performs a receipt
read and never sends; an owner may supply an exact missing `receipt` for an unknown
outcome. Restored old-epoch deliveries cannot be retried or reconciled into authority.

Personal Discord requires OAuth configuration, the default-off personal Discord
flag, and the worker's bot credential. Shared announcements have separate default-off
enable/upgrade flags and a typed channel ID (`disabled` means unconfigured). No
transport credential or verification token is returned in delivery history.

Trusted writer or storage revocation commits a dedicated `owner_health` event,
personal owner deliveries, and their outbox commands in the same transaction as
the transition to observe mode. Its strict evidence binds the source revocation,
resulting runtime version, and immutable recovery epoch. Only that exact current
observe/unowned transition may send; generic intervention and media notifications
retain their normal active-authority requirements. Activation, restore, or another
runtime version supersedes the alert without rewriting its delivery history.
Recipients must still be unrestricted owners with an enabled verified personal
channel. Missing eligible channels produce an explicit unavailable audit event.

An authenticated email-verification request has a separate bootstrap authority:
the current unexpired one-time record, intended address, unrestricted requester,
and current recovery epoch. It can send while observing before an address is
verified. Superseding a request or restoring another epoch fences both delivery
and token consumption. Final sends and receipt reconciliation recheck current
authority under runtime and recipient locks; unknown sends are never retried.

These commands use the ordinary durable outbox. With the default paused schedules,
requesting verification alone does not send an email. After reviewing the exact
Temporal namespace and worker build, run `dispatchMediaOutboxWorkflow` once on
`monorepo-workflows`, or enable only the managed `media-outbox` schedule. The
workflow executor and `media-network` worker must be available. Keep runtime in
observe mode, acquisition/files effect gates disabled, and the other schedules
paused during bootstrap. Dispatch also encounters other queued commands, whose
ordinary authority guards remain protected. A queued command is not delivery
acceptance; verify its attempt and provider receipt. The owner recovery page
reviews protections and does not itself restore writer or storage authority.

The deployment currently omits Discord credentials. Before configuring Discord,
provision `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and `DISCORD_BOT_TOKEN`
in the Media bootstrap item through the repository's password-manager workflow.
Then add required secret-key references for the OAuth ID and secret to
[`api.ts`](../homelab/src/cdk8s/src/resources/media/application/api.ts), and the
bot token only to the network worker in
[`workers.ts`](../homelab/src/cdk8s/src/resources/media/application/workers.ts).
The files worker and workflow executor receive none. Both OAuth fields must be
configured together; partial configuration fails API startup. Keep Discord flags
disabled until provisioning, deployment, and authenticated delivery verification
are complete; optional secret references are prohibited by homelab policy.

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

Retry and manual release selection reauthorize the current database user and Plex
scope before renewing acquisition intent. A historical request does not grant
access to a revoked library; an existing mapped title requires its exact Plex
section for both renewal and a new request. Manual selection also requires the
current owner role. Self requests from Plex-restricted accounts are denied;
explicit owner requests for managed profiles retain their separately verified
library scope. Proxy requests recheck the owner's current role and restriction,
and hold the owner and target identity locks through commit. Media's own
requester restriction applies to both. Keep, pin and
cancellation remain protective actions and do not renew a stale intent epoch.

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

Candidate absolute-number mapping does not yet reach physical file inspection:
absolute-only filenames remain protected even with an approved numbering map.
Yearless TV releases without sufficient identity evidence also remain protected;
the current Select release command cannot supply missing identity approval.

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
manager IDs remain unbound until an exact source-instance association is reviewed.
For Bazarr, `--radarr-instance-id` and `--sonarr-instance-id` declare the opaque
manager instance IDs used by the corresponding captures. These declarations are
recorded as owner supplied, not discovered authority. Association requires the
same manager kind, instance, numeric media ID, and captured video path in a
complete, stable combined bundle. Fresh handoff evidence additionally checks the
actual worker/PVC roots and video bytes; matching path suffixes never suffice.

### Legacy subtitle adoption and policy

Include each subtitle or preference provenance key in the existing handoff
preparation request's `selected` array. Every episode covered by a shared video
must have its exact subtitle association selected. Supported sidecars are SRT,
ASS, SSA, and WebVTT; embedded records require a matching stream index, codec,
language and known forced/HI flags from inspection of that exact video. Bitmap
tracks can be owned but remain quality-unverified. Unknown neighboring files
retain their deletion protection.
An existing nonpurged SubtitleAsset at the selected path or embedded stream
currently requires separate reconciliation and protects handoff. Recovery never
silently reassigns its prior ownership epoch or overwrites its quality history.

For each selected preference, add
`subtitlePolicies: [{provenanceKey, expectedPolicyVersion, chinese}]` to the
preparation request. Use `expectedPolicyVersion: -1` for a first assignment and
`chinese: "unresolved"` or the explicit desired-language choice
`"require_simplified"`. The latter changes the desired policy; it does not label
generic Chinese files as Simplified Chinese or establish human provenance.
Policies retain immutable source evidence and versioned rules. Cutoffs, text
constraints, original-format requirements and unsupported language combinations
remain explicitly protected.

Policy translation follows the pinned [Bazarr v1.6.2 movie indexer](https://raw.githubusercontent.com/morpheus65535/bazarr/v1.6.2/bazarr/subtitles/indexer/movies.py),
particularly lines 238–247 and 317–348: regular `HI=False` accepts either regular
or hearing-impaired captions, while forced subtitles remain a separate target.
`HI=True` requires hearing-impaired captions; regular `HI=Excluded` excludes
them. Audio exclusion/inclusion is evaluated only with known audio evidence.
Forced `HI=Excluded` is protected because its source behavior is not equivalent
to a simple independent flag filter.

Subtitle lifecycle, quality acceptance and ownership are separate fields.
Imported files start `unverified`; historical rows default to an unassigned
ownership epoch. Only accepted subtitles bound to the current owned video's
checksum and version satisfy a requested target. Trusted quarantine/restore and
upgrade rollback receipts preserve quality while rebinding unchanged bytes;
an old-video subtitle never satisfies its replacement. The media page displays
quality and policy readiness separately from physical installation. Manual
uploads can declare forced and hearing-impaired metadata and must still pass
the existing content/provenance validators.

Automatic acquisition merges effective requester languages with the current
immutable policy, applying its audio rules. Publication, reviewed adoption and
new requests enqueue missing targets; the bounded six-hour due sweep also
reconciles existing assets and later policy versions, including assets with
upgrade monitoring disabled. Each target has a separate operation identity bound
to the video, epoch and current request/policy authority. Regular and forced
tracks use separate `.en.srt` and `.en.forced.srt` paths; known hearing-impaired
tracks add `.sdh`. Staged candidates from superseded authority are not reused;
installed quality can still satisfy the same current video and target. Readiness
and personal subtitle-ready notifications require every applicable target.

OpenSubtitles uses `foreign_parts_only` and `hearing_impaired` filters
(`include`, `exclude`, `only`) from its pinned
[official client request contract](https://raw.githubusercontent.com/opensubtitles-dev/service.subtitles.opensubtitles-com/7acfa8f2932a0155ba921212882baa0fade05890/resources/lib/osclient/model/request/subtitles.py).
Returned boolean metadata must prove each explicit target before a download
quota claim; missing metadata is unknown. Plain requested languages and legacy
language-only workflow inputs leave forced/HI unspecified. ASSRT, SubHD and
Zimuku remain usable for those requests, but cannot prove explicit forced/HI
requirements and report an unsupported target. They do not infer those flags
from a filename. Exact release matching, human
provenance, timing and Simplified Chinese checks still apply. Unresolved imported
policy semantics remain protected even when a provider supports the individual
flags.

An existing owned but quality-unverified sidecar does not satisfy readiness and
is never silently overwritten by a newly accepted candidate. A canonical-path
collision ends the install with `subtitle_path_requires_owner_review`. Owners can
select an installed sidecar in Administration's upload form to create a separate
validated candidate without queuing installation. At `/admin/subtitle-replacements`,
select the current subtitle and candidate, prepare the file review, and approve
its exact observation and version. Only the same video, destination and subtitle
format are supported; embedded, unowned, cross-epoch and ambiguous files remain
protected. The video's version does not change.

An unsettled replacement reserves the video against concurrent file lifecycle
changes and ordinary subtitle installation. Reconcile an expired or abandoned
review to check its actual effects; reservations are released only after proven
settlement, never by ignoring an uncertain journal. The retained original is a
recovery-only archive with preserved quality and provenance, not a post-commit
undo option. Its receipt owns its cleanup independently of later video upgrades,
quarantine and restore. Temporal retains settled replacement artifacts for seven
days before attempting guarded cleanup. The review shows a protected operation's
reason and any separate cleanup failure; unresolved ownership or effects retain
the reservation or archive for reconciliation. An expired review cannot approve
a replacement, and reconciliation requires the prior coordinator to be terminal.

A worker killed after creating subtitle source or staging bytes but before saving
their durable file identity leaves
`subtitle_replacement_artifact_ownership_unconfirmed`. The video stays reserved
and those bytes remain in the excluded control root. Matching content or a
filename does not prove ownership, so reconciliation does not automatically adopt
or delete these artifacts. Keep the protection in place while investigating the
exact journal and files; retrying alone cannot supply missing creation evidence.

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

## Legacy-writer evidence

The read-only [observer](src/integrations/legacy-observer/runtime.ts) takes two
bounded Kubernetes snapshots in the `media` namespace. Repository-owned typed
topology requires Radarr, Sonarr, Seerr, Bazarr, Maintainerr, Recyclarr, Prowlarr,
Tautulli, and Whisperbridge to have zero desired/current/ready replicas and an
observed current generation. Live or terminating descendants, relevant writable
PVC consumers, active jobs, and unsuspended schedules prevent quiescence.
Streambot remains a separate read-only library consumer. Plex and qBittorrent
remain running; this observation does not prove that qBittorrent hooks drained.

Only the network worker receives a namespace-scoped Kubernetes account with
`get`/`list` access to workload metadata and PVC identity. It receives no library
mount, Secret access, exec, scaling, or mutation permission. API requests use the
mounted service-account token and CA with normal TLS verification. Snapshot
limits are five pages per resource kind, 2,000 objects, 16 MiB, and 30 seconds;
evidence expires 90 seconds after capture begins. Raw specs remain in memory;
persisted evidence contains identities, digests, counts, and protection reasons.

Mount evidence proves an explicit source-root mapping through the same PVC UID,
PV name, and volume-relative path. It rejects ambiguous mounts, `subPathExpr`,
replacement claims, and changing snapshots. Canonical mounts come from the
unique ready files-worker Pod with a current ReplicaSet/Deployment lineage;
old, competing, or terminating pollers prevent proof. Physical execution must
match its trusted `MEDIA_FILE_WORKER_POD_UID` Downward API value to that proof.
Source controller UID/spec evidence must match the current quiescence lease.
These are expiring observations, not ownership transfer or authorization by
themselves; effect guards must consume a current nonrevoked lease.

Missing retired Deployments currently protect the handoff. Permanent removal
requires a separate reviewed retirement policy binding prior controller and
cluster identity; absence is never automatically treated as successful drain.

The [handoff network producer](src/migration/handoff-network/producer.ts) accepts
only a stored plan ID. It binds fresh controller and actual Pod/PVC evidence,
complete bounded Plex section inventory with exact external identity and Part
paths, current requester access, and selected torrents' full cryptographic
identities and effective seeding policies. Plex scans are limited to 10,000 items
per section; larger or incomplete inventories protect the handoff. Observations
expire after at most 90 seconds and append immutable database records. Final
publication rechecks runtime, review, media, profile, and requester versions under
database locks. This producer performs external GETs only and grants no ownership.
Managed Plex Home claims currently remain protected because an account token does
not independently prove the managed profile's access. Legacy torrent source
cleanup remains protected even when its identity matches; evolving seed counters
are audit evidence and do not change the stable identity/policy review hash.

The [storage refresher](src/infrastructure/handoff/storage-observer.ts) permits
a replacement files-worker Pod only on the same PVC UID, PV name, and
volume-relative path. The source controller UID, generation, spec digest, and
full mount binding must still equal the approved evidence as well as the current
lease; a fresh lease cannot approve a replacement legacy controller. Changed,
ambiguous, unavailable, or expired evidence
revokes storage authority and returns an active runtime to observation mode.
It never adopts a replacement PVC or automatically clears revoked authority.

Native restore uses the [canonical observer](src/integrations/legacy-observer/canonical-mounts.ts)
and [native network producer](src/migration/native-network/producer.ts). Both
`/data/movies` and `/data/tv` must match a previous applied, hash-verified owner
receipt and its persisted storage identity. Two bounded observations bind the
actual ready files Pod, controller lineage, PVC UID, PV name, and volume-relative
path. Native authority refresh preserves that approved identity while allowing a
new Pod on the same storage; it does not invent legacy manager mount mappings.
Legacy handoff authority continues to enforce its original source-controller
binding. Both branches require the independent fresh legacy-writer lease;
missing retired controller definitions remain protected.

Native network observations append immutable evidence without changing asset,
request, or torrent ownership. Fresh Plex identity and Part paths must match the
selected physical coverage. Retained torrents bind full cryptographic identity
and effective policy while excluding changing seed counters from review hashes.
A previously removed source is accepted only with its owned, terminal attempt
history at the recorded epoch and fresh qBittorrent absence. Unknown removal or
unexpected presence protects recovery; this observation grants no source cleanup
authority.

### Rebaseline Media-published files after restoring a backup

Run the documented `restore_observe` procedure before reconnecting workers. An
owner can then open **Recovery review → Reprove Media-published files**. The
inventory is paginated; each explicit review selects at most 25 published files
and 100 covered titles. Preparation requires the exact completed restore
operation, both libraries' current-epoch Plex exclusion proofs, and durable
prior approval of the canonical storage. Missing prerequisites remain visible.

Preparation reads videos, installed sidecars and embedded subtitle identities,
and checks relevant filesystem journals. It does not grant ownership. The owner
reviews affected titles, subtitle quality, exact selected subtitle policies and
physical proof before applying. Apply obtains new process-local content proof,
compares the owner-reviewed inode and ancestor identities, and rechecks current
owner, runtime, storage, writers and Plex evidence. Network observations refresh
during long hashing; expired authority rolls back the complete grant. Repeated
delivery of an acknowledged or lost-ack apply resolves to one immutable receipt.

Native apply renews only exact selected physical versions. It preserves subtitle
quality and historical provenance, and appends selected-title subtitle policies
without renewing policies on unselected siblings. It does not rewrite old
acquisition or notification birth epochs or revive restored request authority.
System recovery holds remain until a separate household review confirms current
intent. A positive declaration backed by the exact native physical receipt, or a
fresh authorized ordinary request, may authorize a new intent. Negative-only
household declarations do not. Personal Keep choices and pins remain independent.

Published files with settled upgrade history use a versioned terminal proof.
An expired rollback copy must have the exact completed purge journal and remain
absent; a cancelled cleanup must bind the completed rollback receipt, restored
video, retained backup and rejected version. These secondary artifacts remain
at their original ownership epoch. Later backup restores follow at most 100
exact native receipt bindings; arbitrary version changes or incomplete journals
remain protected. Historical version-1 plans retain their original meaning.
If a restored caption was later replaced at the same path, the terminal proof
follows at most 20 exact installed-replacement receipts to the current caption.
Each retained artifact is checked, or its completed cleanup journal and absence
are proved. This does not renew ownership or deletion authority for those archives.

The **Committed quarantine** selection reviews complete committed video and
subtitle groups separately from published files. Approval keeps files quarantined
and creates a restore-only continuation. A fresh positive request or household
declaration must authorize every covered leaf before restoration; mixed positive
and negative demand remains protected. The review distinguishes files restored
from playback verified by exact Plex readback. Existing quarantine dates and old
retention decisions remain history, never new purge permission.

Superseded candidates, uncertain filesystem journals, unproved storage replacements
and unresolved subtitle neighbors remain protected and require their separate
restore, rollback or ownership reconciliation paths. Recovery does not override missing Plex watch
evidence or authorize legacy torrent source deletion. Further bounded batches
can extend the current epoch; a later database restore must reprove the files
again against its new epoch and the prior native or legacy storage receipt.
