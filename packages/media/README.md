# Media

Household media requests and automation, with Plex for playback and qBittorrent
for transfers. The application owns its PostgreSQL data; recurring orchestration
belongs to the central `packages/temporal` service.

Implementation and rollout acceptance are tracked in
[AI-300](https://tracker.tailnet-1a49.ts.net/issues/AI-300). This package does not
automatically take ownership of existing library files or torrents.

## Edition scope

Canonical media identity and lifecycle intent are separate. Current-state
requests, reservations, watches, holds, policies and coverage address a
`(mediaId, edition)` scope. Version-1 and version-2 public commands address
`default`, meaning no named cut is asserted; this does not prove a theatrical
cut. They retain their original command hashes and replay results. A movie
request created through those commands remains pending until its subject makes
an explicit edition choice. TV requests retain their existing behavior.

The version-3 movie API exposes the closed registry in
`shared/movie-editions/registry.ts`. The request form begins with no selection;
even **Unmarked release** requires a deliberate choice. The authenticated
subject, or a current owner acting for an exactly mapped managed Home profile,
chooses against the current target, request and choice revisions. The immutable
choice records actor and subject separately. Cancellation, exclusion or loss of
direct demand revokes the live pointer while preserving its history; reviving
the request does not revive that choice.

New choices and fulfillment reads resolve current movie-library configuration
outside their database transactions. Cancel and clear-choice commands use
server and identity authorization independently, so a configuration outage or
revoked library access does not block self protection.

| Route                                                            | Contract                                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v3/media/:id/movie-edition-context`                    | Read-only definitions, subject and current request/target revisions.                                                                   |
| `GET /api/v3/movie-requests?subjectUserId=:id`                   | Paginated requests for the authorized subject, including named pending requests and protection-only rows after library access is lost. |
| `POST /api/v3/media/:id/movie-requests`                          | Explicit edition request with expected revisions and an idempotency key.                                                               |
| `POST /api/v3/media/:id/movie-requests/:requestId/cancel`        | Cancel the exact request without requiring download permission.                                                                        |
| `POST /api/v3/media/:id/movie-requests/:requestId/revoke-choice` | Clear the choice while retaining protective demand.                                                                                    |

The v3 producer leaves named acquisitions pending with `edition_acquisition_not_ready`.
Those commands grant no named download or physical classification authority. An unmarked
choice can sponsor ordinary compatible quality upgrades, subject to the existing
cut checks. Every new movie attempt captures its original choice and revision at
birth; later retries cannot attach or replace that authority. Search, reservation,
submission and file publication recheck the current exact choice. Copying and
hashing prepare an operation-owned partial outside PostgreSQL locks; accepting
staging rechecks the whole attempt under those locks before bounded filesystem
effects. Before copying, preparation refuses an existing partial without proof
of creation; a path or matching checksum does not authorize replacement. Current
Plex access has a process-local expiry guard checked after final awaited work,
alongside the existing storage and execution deadlines. Previously committed
receipts and exact recorded compensation retain their separate recovery paths.

The internal v4 movie producer appends `MovieReleaseAssessment` records rather
than replacing provider snapshots. Each assessment binds the original source
digest, one movie edition, canonical metadata, parser version and immutable
quality-profile version. This allows a result previously rejected by the older
title parser, including one first discovered for another movie, to receive a
new interpretation without changing its original attributes, query coverage or
acquisition receipts. PostgreSQL protects both the assessment and its referenced
provider snapshot from modification. Concurrent equivalent observations reuse
the first literal assessment; profile or catalog changes create another record.
Version-2 movie acquisition identities bind an exact assessment ID and hash.
These contracts are internal; the public v3 routes above retain their behavior.

The internal movie Files contract is a version-2 object, separate from the
historical array file plan. It records exact edition scope, original request
consent, selected torrent member, assessed release/member cut evidence, measured
quality, checksum and predecessor. PostgreSQL prevents replacing a captured
version-2 plan. Inspection rejects conflicting or missing named-cut labels
before probing. Staging accepts only the operation-owned copy after rechecking
current consent, profile, source identity and physical authority. The original
invocation observation, SDK expiry and sixty-second publication bound cover
copy preparation and final acceptance. Embedded English and Simplified Chinese
text tracks follow requests and applicable policy for that exact edition.

Movie publication uses a distinct version-2 intent/outcome containing the exact
movie scope and literal file-plan hash. It shares the existing filesystem
executor and causal effect journal. The intent commits before file publication;
the final transaction records scoped file ownership, extracted caption content
and the observed physical outcome. Retries retain the original intent and
completed receipt. Same-epoch cancellation of unfinished publication replays
only its recorded inverse, preserving the downloaded source. Scope, current
consent, profile, storage authority and the original execution deadline are
checked before new effects. Provenance reads share one 100-record allowance
across the invocation. File publication alone does not prove Plex availability.

The internal v4 Plex publisher verifies complete stable server inventories and
exact metadata readbacks before advancing the selected edition's availability.
Its version-2 movie association includes the registered edition title as well as
the exact movie identity, section, file Part and physical asset. A matching movie
GUID cannot substitute another cut or a merged file. Successful publication
records a distinct immutable completion and verified timestamp; retries read that
receipt before current configuration. Matching requests can be fulfilled from
this exact named association without changing an older request acknowledgement.
Historical version-1 Plex observations retain their literal format and hashes.

The internal movie subtitle protocol carries version-4 operation IDs, asset IDs,
exact edition scope and a current target digest. Named editions inherit the
canonical movie's household subtitle policy when no edition override exists.
An explicit empty override is honored; malformed rules and unconfirmed epochs
remain protected. Personal subtitle targets require current edition consent.
Caption progress does not change the digest for a sibling target.

New inspections record version-2 embedded-stream observations alongside their
literal file plans. Each normalized extraction binds the actual probe hash,
stream index, video checksum and observed forced/hearing-impaired flags.
Missing historical observations remain unknown. Regular, forced and SDH tracks
remain distinct, including when policy alone requires extraction. Exact new
extractions can be reused without provider calls. Provider lookup uses the same
adapters, ordering, global quotas and uncertain-download claims as TV, while
retaining the imported release filename's exact version and cut.
Quota-consuming download claims recheck the current target while retaining the
lookup's original requester observation.

Movie caption installation stages validated bytes outside PostgreSQL and checks
current scope, policy, consent, runtime, storage and physical publication before
the library write. Writer, storage and requester observations captured before
staging keep their original expiry through final publication. Identical
unmanaged destination bytes require owner review.
A distinct immutable completion binds the actual installation journal, original
invocation/SDK deadline, caption facts and physical video parent. Completed
retries acknowledge that record before dynamic configuration. Later publication
lineage follows the actual caption completion using the caller's shared
100-record allowance. These v4 producers remain internal until complete
downstream lifecycle and Temporal/API dispatch support is present.

Playable shared bytes do not fulfill an unchosen request. Readiness delivery
requires matching choice and verified Plex publication; automatic retention
keeps every pending subject's demand protective, including owner and named
requests. The visibility response exposes only the viewer's movie request
fulfillment separately from playback. Unknown command responses retry the
original body and idempotency key; revision conflicts require explicit review.

Default acquisition separately evaluates cut markers in every retained provider
title, original selected torrent member, and current file's original provenance.
Recognized named cuts and ambiguous or conflicting cut labels protect the default
target, including when the current file fails its quality profile. Canonical
title/alias matches prevent titles such as “The Final Cut” from becoming cut
labels. Identity confirmation cannot override this check. Preview exposes the
cut assessment separately from quality; final reservation, submission and file
publication recheck it. Generated library filenames do not prove an unmarked
original. Already committed effects retain their receipt recovery path.

`MediaItem.availability` remains the public default-target projection and is
mirrored transactionally into the default intent. An unrequested catalog item
may have no intent; reading it never creates demand. Missing expected effect
state is an error. Historical default scopes without proven canonical ancestry
retain their references and protections rather than receiving invented lineage
or current ownership authority. Immutable operation, file and recovery evidence
keeps its original serialization and hashes; default scope is interpreted after
validation.

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

### Local system acceptance

With Docker running, the peer check uses the catalog-pinned qBittorrent image,
two disposable peers on an internal network, and a generated H.264 video:

```sh
bun run --cwd packages/media e2e/system/run-peer.ts
```

It exercises the actual WebAPI adapter, an exact submission retry, a real peer
transfer, ownership tags, member progress, and an independent byte checksum.
The peers have no external trackers, DHT, peer exchange, or host-published ports.
The harness sends actual HTTP through container loopback using Docker exec.

The coordinated movie scenario additionally requires the pinned Temporal CLI
and Node, PostgreSQL tools, ffmpeg, ffprobe, and Python 3:

```sh
bun run --cwd packages/temporal scripts/media-system/run.ts
```

It starts from Plex sign-in and an explicit unmarked-edition request over HTTP,
then uses real PostgreSQL, outbox dispatch, Temporal orchestration, Network and
Files Activity queues, qBittorrent, probe/copy/publication, and history replay.
The credentialless Workflow worker runs separately in Node; Activity workers
run in Bun. Catalog, provider, identity and PMS wire responses and ownership
attestations are synthetic. This local scenario does not establish intended-build
Plex compatibility, live provider compatibility, production isolation, or canary
acceptance. The separate native PMS lane and household acceptance remain required.

To inspect the completed scenario in the actual built application, first build
Media, then pass `--inspect-ui` to the coordinated command. It prints the exact
loopback origin and media ID after the HTTP assertions and both history replays
pass. Use a verified headless browser, sign in through the fixture Plex flow,
and capture that title. The process keeps its disposable services available
until interrupted; Ctrl-C runs teardown. This mode uses the same API and client
bundle without substituting browser API responses.

Each command prints its owned temporary evidence directory. Results, generated
media, and diagnostic logs stay there; normal teardown removes only containers
and networks whose exact ownership labels match the run. Neither command reads
production credentials or accesses household downloads or libraries.

### Corpus replay

Replay local release, catalog and torrent-member observations through the
production identity matcher, cut classifier, quality and upgrade evaluators,
ffprobe response parser, coverage checks and naming functions:

```sh
cd packages/media
bun --no-install scripts/corpus/replay.ts \
  --manifest src/testing/corpus/seeds/manifest.json \
  --output /tmp/media-corpus-report.json
```

The output must be a new file; the command never overwrites a report. The bundled
baseline is fictional. The strict manifest in `src/testing/corpus/contract.ts`
references SHA256-bound input, profile and independent label artifacts beneath
its own directory. Inputs contain observed catalog and release fields, optional
member inventories and literal ffprobe JSON. Expected identity, coverage, cuts,
ranking and plans belong only in the separate labels; replay cannot consume them
as authority. Editing artifact bytes requires updating the manifest hash, even
when the change is formatting only.

A native profile supplies explicit rules. A captured Radarr/Sonarr profile uses
its original source snapshot, profile ID and verified source version, preserving
quality definitions, size limits, format scores and upgrade rules. Profiles that
need regex evidence require `--regex-executable /path/to/RegexOracle`, pointing
to the actual packaged matcher; no JavaScript-regex substitute is used. Keep
real captures, private paths and provider identifiers outside the repository in
an explicitly selected private manifest directory. Do not include credentials,
download URLs, API keys or tracker passkeys in any artifact.

Reports distinguish synthetic and captured cases. Outcome totals count candidates
considered, accepted, rejected and successfully planned from actual replay results;
accepted releases can still have protected or unavailable member plans. Difference
totals report wrong acceptance, missed valid candidates, protected ambiguity,
unsupported inputs, ranking differences and plan differences. Wrong acceptance
or an unsafe plan is a hard failure. Missed valid candidates and explicit ranking
or plan mismatches also make the command exit nonzero. Labels must be authored
independently; a legacy application's decision is a comparison, not an oracle.

This is boundary and planning evidence. It does not perform filesystem imports,
prove file ownership, grant request or edition consent, contact providers or
establish live compatibility. Those behaviors require the separate integration
and runtime checks.

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
ownership of an existing torrent. Existing torrents remain outside Media's
ownership; library adoption grants no authority to label them or clean up
their source data. Media manages seeding and source cleanup for transfers it creates.
An unknown add outcome is reconciled without blindly submitting again, including
after the requesting claim is cancelled.

## Media detail and diagnostics

`GET /api/v1/media/:id` includes a bounded `visibility` projection defined in
`shared/visibility/detail.ts`: playback state, up to twenty acquisition attempts,
up to twenty distinct related torrents, and an explicit history-truncation flag.
Download completion, filesystem publication and verified Plex availability are
separate facts. A playable previous version can remain available while an upgrade
downloads. Reads use persisted observations and never contact qBittorrent or
grant effect authority. Collection summaries count visible and playable leaves;
they do not invent one current file version for a series or season.

Freshness is computed by the server. Missing, future, stale and old-epoch
observations are distinct from a current observation; displaying a newer cleanup
evaluation does not refresh the underlying download evidence. Ratios retain the
finite/infinite tagged representation, and duration is actual observed seeding
time. Speeds and ETA are not inferred.

Current owners receive controlled diagnostics for the recorded torrent policy,
its obligations and the most recent seeding/cleanup outcome. Provider settings
are defaults for new torrents, not replacements for an existing torrent's
policy. Meeting a ratio/time obligation does not establish cleanup permission:
ownership, current runtime authority, dependencies, source isolation and final
qBittorrent observations remain independent checks. `Torrent.cleanupEvaluation`
is informational, bound to its policy, observation and epochs; no effect guard
consumes it as authority.

The detail projection rechecks current identity and exact configured-server
library access. Members receive scoped progress and their own household evidence;
owner diagnostics are omitted. Raw observations, private URLs, torrent hashes,
filesystem paths and unrelated shared-pack claims do not enter this response.
Aggregate metrics at `/metrics` remain read-only and contain no media/user/torrent
identifiers.

## Plex association contract

An availability timestamp or Plex rating key does not establish current playback.
`infrastructure/plex-binding` stores immutable associations between canonical
media, complete physical coverage, exact configured server/library, Plex metadata
and Part identity. TV associations include the actual episode, season and show
links and numbering. All leaves sharing one video are verified together,
including members hidden from the viewer. Detail counts include only visible
leaves; an independent valid physical group can still be playable.

Publication verifies two complete bounded Plex inventories, fresh selected
metadata and TV ancestors, then server and library identity again. Inventory
limits are 100 sections and 10,000 items per pass; unsupported multipart files,
ambiguous identity, incomplete pages and conflicting paths protect the group.
The final database transaction rechecks the original publication parent,
ownership, versions, canonical identity and complete lock scope before committing
the association with availability. The `publicationExecution` adapter captures
the invocation's original wall and monotonic timestamps and actual SDK expiry
before awaited work. Fresh authority uses the earliest of entry plus sixty
seconds, the SDK bound, and the existing proof, mapping, root/storage,
writer-lease and exclusion deadlines; awaited work cannot restart that window.
Deferred SQL checks enforce the same minimum at commit, including work performed
after the last JavaScript guard.

The existing inventory reconciliation can queue default-only cold verification
for already owned assets. It neither creates requests nor refreshes consent or
old publication receipts. The `@shepherdjerred/media/plex-binding` export defines
`reverifyPlexBinding`: its strict input contains schema version, operation ID,
recovery epoch and up to 100 sorted unique asset IDs. Complete coverage remains
in PostgreSQL. Its result is verified with a binding count, superseded, or
protected with a bounded reason; the UTF-8 history envelope is at most 128 bytes.
An exact completed receipt can be read after proof expiry without new Plex I/O.

Native authority resolvers share one `PublicationAuthorityReadBudget` across an
invocation. Its 100-record allowance covers receipt and transition provenance,
including the model rows selected to validate their proof parents. Included
relations and repeated queries consume the allowance; JSON fields remain part of
their containing record. Weighted queries request one extra result to detect
overflow and protect the complete operation.

Known parent rows may be reused within the transaction that read them, under the
same allowance and required locks, with their raw hashes and bindings checked.
Each transaction creates its own reader. Current ownership, requests, holds,
mounts and expiry checks remain live. Complete current scope snapshots retain
their separate native video, coverage and sidecar bounds.

The allowance can reserve a known query cost before SQL executes. A refused
charge describes admission cost; it does not establish how many rows the query
returned. Existing conservative charges remain part of the allowance.

Archive cleanup and publication compensation measure bounded file and journal
content before acquiring database or path locks. Discovery supplies comparison
data; it cannot authorize writes. Measurement preserves absent paths and never
creates parent directories or execution namespaces. A fresh locked transaction
validates the complete authority, original Plex proof and measurement before
stat-only sealing and recording execution. Filesystem effects follow that commit
in another transaction with fresh authority. Both transactions share the original
invocation allowance and shrinking SDK, proof and storage deadlines. A committed
compensation execution with a missing namespace remains protected rather than
recreating it.

`bindPlexTransactionDeadline` queues deferred validation even when a transaction
writes no Plex association rows. Its transient work record grants no permission
and is removed on success; deleting it cannot waive the already queued check.

The visibility response exposes
`playback.association.{legacyUnverifiedItems,reconciliationRequiredItems}`.
Revision-zero legacy inventory may receive an explicit unverified label but
cannot grant readiness. Clearing or replacing a binding cannot revive readiness
from an old timestamp. No current asset is ordinary pending state, with both
association counts zero. Named movie choices remain subject to the separate
edition admission contract above.

## Plex watch event hints

`POST /events/plex` accepts bounded multipart event hints through a dedicated
query capability, outside browser session/Origin/CSRF middleware. The typed
`plexEventHintsEnabled` flag defaults off; the optional API bootstrap
`PLEX_WEBHOOK_SECRET` must also be configured. A missing, invalid or duplicate
query key cannot read the request body or enqueue work. The authenticated reader
caps the whole body at 2 MiB and its single JSON payload at 64 KiB; an optional
poster is discarded. No account, player, poster or raw payload is stored.

Hints resolve only an exact configured-server, section and rating-key mapping to
one existing default target. Unsupported or ambiguous hints return the same
generic acknowledgement without creating catalog records or intent. Accepted
hints commit an operation and outbox record before acknowledgement; a 30-second
receiver-time bucket coalesces duplicates. The network workflow reads current
watch state with each effective requester's scoped token. Event account IDs and
scrobble notifications never directly set watched state or permit deletion.

The shared polling/event observer allocates a whole-media ordering revision
before external reads and atomically commits the complete current cohort.
Epoch, mapping, credential, claim or generation drift and older completions
cannot refresh or invalidate newer watch evidence. Unknown scoped metadata,
including a missing rating key after quarantine, remains protected. Existing
polling, warning/grace, recovery holds and final watch/session guards continue
to apply; the endpoint grants no new deletion or acquisition authority.

Capability-bearing URLs must never enter logs, error callbacks, traces or
workflow history. Application errors expose only fixed categories and request
IDs. The current source adds no HTTP trace collector. Proxy/PMS URL logging,
HTTPS reachability, query preservation and real event delivery still require
separate verification before activation. Source availability does not enable
delivery, provision a secret, or establish live acceptance.

## Storage capacity observations

`GET /api/v1/admin/capacity` returns Movies and TV observations to the current
unrestricted owner. The recovery page displays the same safe projection: sample
time, current total/available bytes, and explicit missing, failed, stale, future,
old-epoch or changed-root states. Capacity values in the API and `/metrics` come
only from PostgreSQL; reads neither inspect mounts nor create authority. Byte values are decimal
strings, including valid zero available space. The two roles may share one
filesystem, so their capacities must not be added together.

The dedicated `media-capacity` Temporal Schedule is initially paused. Its new
Workflow observes canonical mounts on `media-network`, then samples the exact
roots on `media-files`. The typed `capacityObservationEnabled` flag defaults off;
both Activities resolve it before allocating observation revisions or doing I/O.
The response reports collection status separately: turning collection off does
not falsify a still-current saved sample. Deployment, enabling collection and
observed live capacity are separate acceptance steps.

The observational `MediaCapacityObservation` rows support observe mode without
writer leases, storage authority or handoff receipts. Each phase allocates its
own ordering token before external I/O. Late success or failure cannot overwrite
a newer invocation. Samples bind exact root/PVC/volume/worker/epoch facts;
benign proof renewal preserves the sample time, while changed identity or an
expired current mount proof suppresses byte values. Samples age out after five
minutes. No unknown measurement becomes zero free space.

`media_storage_capacity_state` exposes fixed role/state labels, and current-only
total/available byte gauges use decimal exposition. Prometheus stores floating
point values, so downstream arithmetic is not byte-exact. These measurements
neither reserve space nor grant ownership, cleanup or write permission. Existing
immediate copy-time capacity checks remain authoritative; collection never
changes acknowledgement of an existing file operation.

## Ownership handoff API contract

The owner-only handoff API accepts stored immutable migration bundle reviews.
Normal session authentication, CSRF protection, and an `Idempotency-Key` apply to
commands. The application never accepts caller assertions of stopped managers,
verified files, or trusted mount identities.

| Endpoint                                | Contract                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/admin/handoffs`           | Exact bundle/review hashes and versions, runtime epoch/version, explicit provenance selection, and immutable imported profile bindings. Initial library adoption uses per-file movie classifications; schema version 3 adds explicitly approved Plex label correction. Returns an operation and handoff ID. |
| `GET /api/v1/admin/handoffs/:id`        | Current preparation state, exact selected scope, complete proof plan/hash, expiry, and eventual receipt ID.                                                                                                                                                                                                 |
| `POST /api/v1/admin/handoffs/:id/apply` | Exact prepared plan hash/version and runtime epoch/version, with the matching protocol. `ApplyLibraryHandoffV2Schema` acknowledges household holds; historical `ApplyHandoffSchema` also acknowledges protected legacy sources. Queues fresh proof and an apply operation.                                  |

Preparation authorizes observation only. File hashing and probing run on
`media-files`; a concurrent Temporal activity refreshes network evidence every
30 seconds on `media-network`. Apply hashes again, compares the exact reviewed
identity evidence, and checks current owner authority under the final database
locks. Video content remains unchanged. A durable receipt makes a committed
apply idempotent after an interrupted response.

Library-only reports use an explicit `schemaVersion: 2` and
`purpose: "initial_library"` when creating the review bundle. They require the
Radarr and Sonarr library captures; Bazarr captions and policies are optional.
They exclude request and torrent captures, associations and requester inventory.
Proposed source/canonical roots remain unverified until the trusted handoff
observer proves the actual mounts. Earlier complete-bundle bodies and hashes
retain their original format and source requirements.

Initial library adoption uses schema version 2 for observation or schema version 3
with `plexEditionLabels: "update_in_place"` for automatic label correction.
Each selected movie file needs
one registered edition and either matching conventional filename evidence or an
explicit owner resolution of that exact captured source record. Missing cut
labels establish only an unmarked release; `DC` requires review. Classification
suggestions in schema version 3 can come from conventional filenames before the
separate owner review. Omitted movie overrides do not approve the suggestion or
grant file ownership; ambiguous names require an explicit file-level override.
Classification
precedes the first physical ownership record, retains the existing path, and
cannot reassign an already tracked file. Multiple cuts of one movie retain
separate assets and targets. TV/anime shared files retain exact episode coverage.

The network observer verifies the same server, section, movie/episode identity,
Plex Part, existing path and registered movie edition label. Schema version 2
protects adoption when a label differs. Schema version 3 presents exact per-file
label changes in the owner-reviewed plan, including clearing the label for an
unmarked release. Files Activities reprove the reviewed bytes before Network
Activities edit only the existing item's edition field. A durable intent precedes
each PUT; a retry observes that intent without resending it. Readback must retain
the same server, section, item, Part, path and identity, with no decrease in watch
count or progress. An uncertain write fences later ownership of that file until
confirmed. Failed or cancelled application requires owner review. Historical
completed acknowledgements retain their original sources and SDK expiry.
The receipt retains the initial asset and caption snapshots as well as the
reviewed filesystem and Plex evidence, plus actual label-edit checkpoints for
schema version 3. Caption ownership does not establish
subtitle quality. These reads share one 100-record provenance allowance across
the batch. Request consent and existing torrent ownership are not inferred.
Request and torrent records are excluded from this library-only protocol;
its network observations do not authenticate with or inventory qBittorrent.
Overseerr request import is optional and separate. Historical handoff records
retain their original format and acknowledgement behavior.

Movie file and caption operations can use the distinct
`movie_library_adoption_v2` physical parent. The reader validates the original
immutable plan, receipt, exact classified asset snapshot, file identity evidence
and Plex association before comparing current physical state. Installed captions
prove their own completion lineage. Historical acknowledgements read these
original records before current flags or intent. This ownership proof creates
no acquisition attempt, requester consent or authority over existing torrents;
new acquisition sponsorship remains a separate check.

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

Catalog adoption and refresh store a versioned `externalIds.catalogIdentity`
snapshot with namespace-qualified TMDB/IMDb/TVDB references, original titles and
alternative titles. Writes preserve unrelated Plex and owner-numbering keys.
Conflicting existing identities protect the record. Current tracker adapters
omit structured catalog references because their verified wire contracts do not
establish those fields. Their actual title fields are retained as attributed
edition text, including distinct secondary title fields; this is text evidence,
not a structured provider edition claim. Synthetic identity fixtures do not
establish upstream identifier support. Rediscovery with changed attribution
cannot rewrite an existing candidate snapshot, even before it has an attempt.
Historical primary-title-only sources keep their original bytes and hashes.

The owner numbering API reads `GET /api/v1/admin/numbering/series/:id/groups`
and `GET /api/v1/admin/numbering/series/:id/groups/:groupId`. Only a listed TMDB
Absolute group can produce `POST .../series/:id/group-preview`. The owner chooses
one subgroup and its first absolute number; raw subgroup and episode orders are
retained, never flattened or treated as an implicit `order + 1` convention.
Every group episode must join the complete catalog by exact TMDB episode ID,
series identity and canonical season/episode coordinates.

`POST .../series/:id/group-commit` binds the returned group, catalog and numbering
digests, at most 100 exact episode/version/number pairs, and an explicit list of
existing mappings approved for replacement. Further batches require a fresh
preview of the same upstream group. Upstream reads occur before the transaction;
changed responses, concurrent mappings and collisions with unselected siblings
reject the batch. Canonical-root-first locks and a series version increment fence
older serializable catalog snapshots. Canonical episode coordinates remain
unchanged; each assigned absolute number retains its source and owner decision.

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

The browser's `SessionBoundary` retires authenticated read and mutation caches
before publishing a changed user or authorization fingerprint, including Plex
account, role, restriction and user version changes. Local forms remount with
the session generation, and delayed responses or callbacks from the retired
generation cannot populate the new session. This boundary cannot undo writes
already sent to the server. Pending command keys remain bound to their original
actor, path and body; a session change preserves those keys without automatically
replaying commands. Server-side authorization remains independent of this
browser isolation.

Changes to an existing Plex access mapping advance the user's version when its
server identity, permitted libraries, media kinds or Plex restriction changes.
Authentication returns the refreshed actor, so the first `/me` response exposes
the new version. Account-row locking makes concurrent identical refreshes advance
the version once; refreshing unchanged access does not retire the browser cache.

Default-target browser controls use the default-only v2 command protocol.
`GET /api/v2/media/:id/targets/default` returns the observed media version and
target version; a null target version means the target is absent. The read never
creates an intent. `POST /api/v2/media/:id/commands` accepts a strict
`{schemaVersion: 2, scope: {mediaId, edition: "default"}, expected:
{mediaVersion, targetVersion}, command}` envelope. The inner `action` selects
request, Keep, pin/unpin, restore, remove, Retry, release selection, or request
cancellation. Cancellation also supplies the exact request ID and version.
Unknown fields and named editions reject. Commands compare both versions after
locking the complete affected scope, before creating or changing any target.
A conflict requires reviewing the changed state before another submission.

The v2 response contains `result` and `appliedVersions` from the same committed
transaction. Idempotent replay returns that original response, even after later
changes; reusing a key across different v1/v2 commands conflicts. V1 input hashes,
saved responses, workflow payloads, physical plans, and immutable evidence remain
unchanged. Both protocols use the same transactional command work and outbox.

The context read distinguishes detailed access from `protection_only`. When
library access is stale or revoked, an existing requester can still obtain only
the scope/version fields and their own request actionability needed for Cancel
and effective-request Keep. Current owners retain protective pin controls. This
minimal response reveals no titles, ancestry, files, playback, or other people's
requests. New commits recheck current role and claims under locks; acquisition
keeps its existing permission, epoch, quality, and cut checks. Orphan lineage
stays unresolved, and protective actions do not renew its automation authority.

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

Subtitle installation and restoration share `publicationAuthorityDeadline`:
the original `publicationExecution` clocks and SDK expiry bound the sixty-second
window and current root/storage, writer-lease and exclusion minima. A later
authority lookup or transaction cannot renew the original bound. Existing
embedded or installed subtitle checks and exact restored acknowledgements keep
their early-return ordering without granting new effect authority. New effects
and deferred SQL completion retain the same shrinking deadline.

Filesystem scopes retain a separate kernel lock for every exact path. Python 3
helpers acquire those same ordered locks in batches of at most 128 descriptors,
bounding helper and descriptor use without replacing them with a coarser lock.
Partial acquisition releases the whole scope; loss of any helper invalidates
ownership and protects subsequent effects. Lock files are never deleted to
recover ownership.

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

The Media API image belongs to the existing media chart's Streambot & media
release owner. Delivery records its selected artifact; Git contains no running
Media digest. The chart constructor leaves the parallel application absent
unless given an explicit image selection. Its synthesis recipe must be bound
to an immutable artifact by Delivery before rendering a deployment.

The [API](src/server/index.ts) commits intent and an outbox row together. The
[outbox dispatcher](src/automation/store.ts) starts workflows using stable IDs;
a failed Temporal connection leaves the command available for later delivery.
The UI reads PostgreSQL projections rather than querying workflow histories.

[Temporal workflows](../temporal/src/workflows/media/core.ts) carry identifiers.
Provider credentials and candidate payloads stay in PostgreSQL and Activity
processes. The network worker owns authenticated external calls. The file worker
has read-only download access and writable library access, without provider
credentials. It receives the configured Plex machine ID to recheck each covered
requester's current library scope; Plex authentication remains on the network
worker. Their [deployment](../homelab/src/cdk8s/src/resources/media/application/workers.ts)
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

New acquisition attempts bind an immutable identity snapshot to the selected
candidate, canonical media, sponsor and recovery epoch. The release review lets the current
unrestricted owner confirm an ambiguous or yearless release against exact
canonical episodes. Its server-generated preview binds the candidate, numbering
and current versions. Confirmation resolves identity only: conflicting strong
identifiers still reject, and audio, edition evidence, scores, size and upgrade
requirements remain independent quality checks. A searched-media association
makes unresolved candidates visible within the caller's current library scope;
it grants no coverage, download or ownership authority.

Candidate matching and physical inspection share coordinate resolution. Absolute
filenames require an explicit canonical map, and every new file plan binds the
observed torrent file index, name, size and exact episode coverage. Staging and
publication recheck the source and numbering; remapping or revoked access
protects the operation. Season packs require complete canonical coverage and
recorded sponsorship before submission. Series revision fences keep numbering
and catalog changes visible to waiting transactions. Historical attempts and
file plans retain their original behavior and hashes; identity evidence cannot
be added afterward to reinterpret an old acquisition.

Requested-edition selection is unavailable; attributed edition text alone
does not define an edition target or permit replacing a different edition.

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
An identical existing sidecar still requires its own completed installation
journal or owner review; matching bytes do not promote an unverified record.

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

The **Review upgrade archives** page reviews committed upgrade pairs and their
complete recorded successor chain. Selecting A from A→B→C proves retained B and
current playback C too, but grants expiry only for selected A. A review contains
at most 25 video assets and 100 covered titles. Original upgrade plans,
cleanup records, birth epochs and seven-day rollback deadlines remain unchanged.
Preparation proves exact archive content, original import and sidecar journals,
current Plex playback, no active sessions, and archive absence across every
bounded movie and TV section on the configured server.

Approval renews physical ownership and creates immutable, receipt-bound cleanup
continuations. It never deletes bytes or renews household demand. Cleanup still
requires fresh current intent authority, cleared system recovery holds, no Keep
or pin, the original elapsed deadline, current worker/storage/exclusion proofs,
and the existing purge gate. Fresh unresolved legacy claims protect cleanup.
A later B-only review can reuse unchanged published or archive native grants
without changing versions, subtitle quality, runtime version or holds. The review
shows new grants and reused evidence separately. Cleanup can resume the same
continuation after an exactly identified closed Workflow, retaining its original
execution identities and journals; uncertain foreign effects remain protected.
Completed cleanup receipts prove terminal archive absence in later native reviews.

New ordinary publications retain a complete immutable intent before effects,
actual durable filesystem acknowledgments, and a separate committed outcome.
The acknowledgments bind the exact file identities, ancestor directories and
literal journal bytes. A journal-completion acknowledgment records the actual
atomic journal replacement separately from media link, rename and unlink
effects. Existing version-1 plans and journals keep their original bytes and
meaning; historical inode identities are never reconstructed from checksums.
Ordinary publication supports its existing complete coverage of up to 100 files
and 100 leaves. Recovery reviews have the smaller 25-video-asset union limit
and protect oversized transitions without truncating them.

After a serving upgrade C→D, a new archive review can follow the exact adjacent
publication receipt back to C's original native grant. It keeps A/B deadlines
and historical receipts unchanged; C's deadline remains tied to D's actual
verified publication. Replacing an old cleanup continuation requires a trusted
terminal observation of its exact Workflow run and fresh proof that every
selected byte remains unchanged and every old purge journal is absent. An
allocated execution record with no effects can satisfy this proof. A prepared
or completed purge journal with an uncertain database outcome cannot. The old
continuation becomes terminally superseded, and only the new reviewed
continuation may proceed.

The **Review interrupted upgrades** page handles proof-backed partial
publication after a database restore. The owner reviews the whole interrupted
plan, its exact acknowledged effects and the inverse steps needed to recover
the predecessor. Approval grants compensation only; it neither resumes the old
attempt nor deletes the successor. Missing acknowledgments, substituted
same-byte files and changed ancestors remain protected. A subsequent restore
can review an interrupted inverse through its exact bounded acknowledgment
ancestry and the prior coordinator's trusted terminal observation.

Physical compensation preserves the old attempt, release and publication
history. It settles only the reviewed reservation tuples, leaves the predecessor
importing under recovery holds, and retains successor bytes. A separate effect
fence blocks conflicting acquisition, subtitle, rollback, removal and native
effects until fresh whole-group household intent and a separate scoped Plex
publication verify the exact predecessor bindings. Mixed demand keeps the whole
physical group held. Lost acknowledgments resolve through immutable completion
and verified-publication receipts. Later caption installations and replacements
require their own exact app provenance, completed journals and fresh physical
proof; they do not modify the original compensation receipt. The same proof
participates in later video upgrades, native rebaselines and archive review.
Compensation does not renew an old subtitle policy: replacement still requires
a current requested target and reconciled policy authority.

Uncertain filesystem journals, unproved storage replacements
and unresolved subtitle neighbors remain protected and require their separate
restore, rollback or ownership reconciliation paths. Recovery does not override missing Plex watch
evidence or authorize legacy torrent source deletion. Further bounded batches
can extend the current epoch; a later database restore must reprove the files
again against its new epoch and the prior native or legacy storage receipt.
