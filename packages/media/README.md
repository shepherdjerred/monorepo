# Media

Household media requests and automation, with Plex for playback and qBittorrent
for transfers. The application owns its PostgreSQL data; recurring orchestration
belongs to the central `packages/temporal` service.

Implementation and rollout acceptance are tracked in
[AI-300](https://tracker.tailnet-1a49.ts.net/issues/AI-300). This package does not
automatically take ownership of existing library files or torrents.

## Household keeping and viewing APIs

Requests distinguish permanent keeping policy from temporary interest. New owner
requests require an explicit `keep` or `temporary` choice; member requests are
temporary. Only the owner can grant permanent keeping. Migration keeps existing
library scopes protected, while existing request interests remain temporary.
An explicit owner library
policy overrides inherited migration defaults without waiting for episode pages
to expand. Independent personal Keeps still protect shared files.

Temporary interest is `following`, `finished`, `dropped`, or `expired`. A watched
movie can finish automatically. A TV request completes automatically only with
fresh ended/cancelled metadata and complete requested, released coverage;
catching up on an ongoing series keeps the subscription. Whole-show protection
is checked through the ancestor chain before file effects. Finished and Drop
retain request history while stopping future acquisition authority.

Restarting a request that finished automatically after a watched movie or completed
series starts a fresh viewing cycle. Existing Plex watched flags, early progress
and history cannot finish that new cycle: each required movie or episode needs a
new native completion bound to the current person and media identities. Unknown
or rebound identities protect the request. Ordinary Keep watching resumes an
unfinished cycle and retains completed-episode credit. Re-requesting after manual
Finished, Drop, expiry or cancellation also preserves that cycle. Normal 30/60-day
inactivity clocks and private-notice rules still apply from the renewed interest.
Marking automatically finished content unwatched in Plex does not renew interest
or restore quarantined files. Keep watching or Request again is required.

Inactivity clocks advance only when proven usable, unwatched content is
available: 30 days before starting, or 60 days without further meaningful
progress. A private interest reminder provides seven days to reply. Its exact
request revision must have an accepted private delivery or an acknowledged
in-app view; failed or unknown delivery cannot expire interest. Watching or
Keep watching renews interest and invalidates an older reminder. When no Keep
or interested requester remains, removal still requires the existing identity,
playback, ownership and file-cohort checks, a seven-day Leaving Soon period,
and seven days of recoverable quarantine before purge.

The authenticated read APIs are bounded and do not create acquisition or
removal authority:

| Route                              | Purpose                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/v1/library`              | Current visible library, keeping policy and personal interest.          |
| `GET /api/v1/calendar`             | TV air dates and US theatrical, digital and physical movie dates.       |
| `GET /api/v1/removals`             | Titles that are leaving soon, and quarantined titles still recoverable. |
| `GET /api/v1/removal-history`      | Committed quarantine/removal history, retained after purge.             |
| `GET /api/v1/playback/now-playing` | Separate whole-library playback observations, with explicit freshness.  |
| `GET /api/v1/playback/history`     | Searchable session history, separate from current Plex watched truth.   |
| `GET /api/v1/playback/statistics`  | Plays, watch time, rankings and playback decisions.                     |
| `GET /api/v1/request-interests`    | Personal interest state, notice and revision context.                   |

`POST /api/v1/request-interests/:id/commands` applies revision-checked,
idempotent interest actions. `POST /api/v1/library/:id/keeping-policy` changes
owner library policy against the current media and target versions. Opening a
notification link never changes these states.

Each now-playing and history session carries `media`, the library title it
belongs to, resolved when the session is read from the Plex item Media holds for
its rating key. It is null when no such item exists or the reader could not open
the title page, including while the reader's Plex access is stale. It names the
played movie or episode with the `rootMediaId`, `rootTitle` and `artwork` of
its movie or series, so an episode's play can name its series.

Calendar dates retain their source date-only precision, including TBA, rather
than treating UTC midnight as an airing instant. Viewing history uses separate
playback tables and a dedicated Plex parser; immutable file-serving evidence is
unchanged. Statistics retain the two-minute minimum play and 85% reporting
completion threshold. Neither historical import nor statistical completion
writes current Plex watched state or authorizes retention. Household playback
is owner-visible; members see their own sessions, and unmapped history stays
owner-only.

### Library

`GET /api/v1/library` lists the movies and series the household holds: every
title with a library Keep, a standing request or a current file, in a Plex
library the reader may open. A reader whose Plex access was not verified in the
last five minutes gets 403 `plex_library_access_required`.

| Parameter      | Values                                       | Default |
| -------------- | -------------------------------------------- | ------- |
| `query`        | Text the title contains, ignoring case.      | empty   |
| `kind`         | `all`, `movie`, `series`                     | `all`   |
| `sort`         | `title`, `added`                             | `title` |
| `policy`       | `all`, `keep`, `temporary`, `unclassified`   | `all`   |
| `mine`         | `all`, `following`                           | `all`   |
| `leaving`      | `all`, `soon`                                | `all`   |
| `availability` | `all`, `available`, `unavailable`            | `all`   |
| `limit`        | 1 to 50                                      | 25      |
| `cursor`       | The previous page's `nextCursor`, unchanged. | none    |

An unknown value, or a cursor that the chosen `sort` did not issue, is 400
`invalid_input`.

- `sort=title` lists every matching title, A to Z.
- `sort=added` lists newest first by `addedAt`, and lists only titles that have
  something to play: a title with no current file has no date and is left out.
- `policy` and `mine` match the `policy` and `myInterest` each row reports.
  `mine=following` keeps the titles the reader has a standing request for.
- `leaving=soon` keeps the titles that report `leavingSoon`.
- `availability=available` keeps a movie whose `availability` is `available`
  and a series whose `episodes` counts at least one available episode. A series
  whose `episodes` is `null` also counts as available, because an external
  library holds some of it. `availability=unavailable` is every other title.

A page holds at most `limit` titles and may hold fewer, or none, while
`nextCursor` is still set: what a reader may see and whether an external file
is really present are settled after the page is read. Keep following
`nextCursor` until it is `null`.

Each title carries, besides its `policy`, `myInterest` and `artwork`:

| Field          | Meaning                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| `availability` | A movie's lifecycle state. Always `null` for a series.                                        |
| `episodes`     | A series' regular-season episodes, `{ available, total }`, as the catalog reports them.       |
| `addedAt`      | When the newest part of the title that can be played now first arrived. `null` when none can. |
| `leavingSoon`  | `{ state, graceUntil }` for the soonest removal anywhere in the title, or `null`.             |

`addedAt` is derived, not stored. For each movie or episode that has a current
file, Media takes the first file it ever recorded for that item; the title's
date is the latest of those. An upgrade keeps the earlier file's record, so it
does not move the title, and a series moves up when a new episode lands. A file
in a registered external library counts from when Media first recorded it.

`leavingSoon.state` is `warning_pending` while the title's requesters are being
told and no date is set, or `grace_period` once the files are due to leave at
`graceUntil`. A series reports its first episode to go. A quarantined title has
already left and is not leaving soon.

### Leaving soon

Leaving soon belongs to the whole household. `GET /api/v1/removals` and
`leavingSoon` show a member every title that is `warning_pending` or in its
`grace_period` and sits in a Plex library that member may currently open,
whoever asked for it. Any such member may place the 30-day hold on it (`keep`
through `POST /api/v2/media/:id/commands`); `GET /api/v2/media/:id/targets/default`
lists `keep` in `allowedProtectiveActions` for them while the removal is open.

Only that is shared. The hold is the holder's own: it protects the title for
30 days, cancels the open removal, and creates no request. When it lapses,
retention does not wait on the holder; a later removal starts again from a fresh
notice, which goes to the members who asked for the title and not to the one
who held it. Pinning, permanent keeping, removal, retry, cancelling a request
and restoring a quarantined title are unchanged: they stay with the owner and
with the members who have their own request, and a quarantined title is listed
only for them. A member whose Plex access is stale or does not cover the
title's library sees only their own titles and gets no hold on anyone else's.

`GET /api/v1/requests` returns at most 200 rows. Direct requests come first, so
the per-episode claims a long series fans out into cannot push them off the
list.

### Catalog discovery

| Route                                      | Returns                                    |
| ------------------------------------------ | ------------------------------------------ |
| `GET /api/v1/catalog/search?q=&page=`      | One page of TMDB title search results.     |
| `GET /api/v1/catalog/discover?feed=&page=` | One page of a browse feed, same shape.     |
| `GET /api/v1/catalog/:kind/:id`            | One movie or series, with its season list. |

`GET /api/v1/catalog/:kind/:id` also carries `runtimeMinutes`: a film's runtime
in whole minutes as TMDB lists it, or `null` when TMDB does not know it (TMDB
sends 0 for that). It is always `null` for a series. TMDB gives a series no
runtime, only `episode_run_time`, a list of typical episode lengths that is
often empty; Media does not turn that into an average.

`page` is 1 to 5 and defaults to 1; `totalPages` never exceeds 5. `feed` is one
of:

| `feed`            | TMDB list                           |
| ----------------- | ----------------------------------- |
| `trending`        | `trending/all/week`, people removed |
| `popular_movies`  | `movie/popular`                     |
| `popular_series`  | `tv/popular`                        |
| `upcoming_movies` | `movie/upcoming` for region `US`    |
| `on_the_air`      | `tv/on_the_air`                     |

A feed page is fetched from TMDB once and held in the API process for six
hours; expiry is checked when the page is next read. When TMDB is down,
throttling or unreadable, all three routes answer 502 `catalog_unavailable`; a
title TMDB does not know is 404 `catalog_title_not_found`.

Every title carries `library`, which is `null` unless `GET /api/v1/library`
would list that title for the same reader:

| Field          | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `mediaId`      | The household's row for the title.                                                                |
| `availability` | A movie's lifecycle state, as the library reports it. `null` for a series.                        |
| `episodes`     | A series' regular-season episodes: `{ available, total }`, specials left out. `null` for a movie. |
| `requested`    | Someone in the household has a standing request for the title.                                    |
| `myInterest`   | `following`, `released` or `none`, as the library reports it.                                     |

`requested` is true when anyone in the household, the reader included, has an
active, not excluded request with interest `following` on the title. It says
the title is wanted, never by whom, and it is reported only on a title the
reader may see.

`episodes.available` counts Media's own lifecycle state. `episodes` is also
`null` for a series when a registered external Plex library covers any of its
episodes: the count is then unknown rather than zero, because proving which of
those files are present is done per file on the title page.

Responses also carry `libraryAccess`. `stale` means the reader's Plex library
access was not verified within the last five minutes, so every `library` is
`null` without meaning "not in the library"; the same condition makes
`GET /api/v1/library` answer 403 `plex_library_access_required`.

## Artwork route

Browsers never contact TMDB. `GET /api/v1/artwork/:size/:file` serves a TMDB
image from the Media origin to a signed-in member, and keeps the bytes on disk
so an image already fetched keeps serving while TMDB is unreachable.

| Part     | Contract                                                                |
| -------- | ----------------------------------------------------------------------- |
| `size`   | `w185`, `w342`, `w500`, `w780` or `w1280`; there is no `original`.      |
| `file`   | 8 to 64 ASCII letters or digits, then `.jpg` or `.png`; never SVG.      |
| Upstream | Always `https://image.tmdb.org/t/p/<size>/<file>`, with no credential.  |
| `200`    | The image, with `Content-Type` and `Content-Length`.                    |
| `400`    | `invalid_input`: the size or file name is outside the contract.         |
| `404`    | `artwork_not_found`: TMDB has no such image.                            |
| `502`    | `artwork_unavailable`: not cached, and TMDB could not supply the image. |

The allow-list and file pattern live in
[`src/shared/artwork/proxy.ts`](src/shared/artwork/proxy.ts). A success carries
`Cache-Control: private, max-age=31536000, immutable`: `private` so a shared
cache in front of the origin does not store an image that is only served
behind a session, and `immutable` because a size and file name always name the
same picture; TMDB gives changed art a new file name. Every error keeps the
application's `no-store`.

An upstream response is accepted only when it is a `200` of at most 4 MiB whose
content type is `image/jpeg` or `image/png`, matches the file extension, and
whose leading bytes carry that format's signature. A redirect, any other status
or type, an oversized body, a timeout (30 seconds) and a rate limit are all
failures and are never passed through, so the route cannot be used to reach
another host or to serve other content. A `404` is remembered in memory for ten
minutes (at most 1024 file names; an entry expires when it is next read).

The cache directory is the bootstrap setting `MEDIA_ARTWORK_CACHE_DIR`, which
defaults to `/tmp/media-artwork`. In the cluster that is the API pod's
`emptyDir`, so the cache starts empty on every deploy and pod restart until
the deployment mounts a volume and points the variable at it. The API creates
the directory when it starts and refuses to start when it cannot create or
write it; it never runs without the cache or moves it elsewhere. Files are
stored as `<directory>/<size>/<file>`, written to a temporary file in the same
directory, synced and renamed, and never expire. The cache is keyed by size
and file name, not by content: TMDB's CDN may re-encode a file, so two fetches
of one name can return different bytes, and a cached copy stays a valid image
for that name until it is evicted. The cap is the `media-artwork-cache-max-bytes`
flag (1 GiB by default, read when the API starts); a write that takes the
cache past it evicts the least recently used files. Recency is held in an
in-memory index built from one directory scan at first use, ordered by file
modification time, so a hit never writes to disk and a restart falls back to
oldest-written-first. Nothing runs on a timer.

A cached file is served whatever state TMDB is in. A cached file that is
missing, empty or does not start with its format's signature is logged
(`media_artwork_cache_corrupt`), removed and fetched again rather than served.
Concurrent requests for one image share a single upstream fetch, at most six
fetches run at once, and once 256 more are waiting further misses answer `502`.
`/metrics` reports `media_artwork_requests_total` and
`media_artwork_upstream_total` by outcome, the eviction and corruption
counters, and the cache's entry and byte gauges; upstream failures, evictions
and corruption are also logged as JSON lines.

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

The household client no longer calls these routes; it uses the version-4 routes
below. They stay mounted so an acknowledged version-3 command replays its
original result, and integration tests drive them directly.

The v3 producer leaves named acquisitions pending with `edition_acquisition_not_ready`.
Those commands grant no named download or physical classification authority. An unmarked
choice can sponsor ordinary compatible quality upgrades, subject to the existing
cut checks. Every new movie attempt captures its original choice and revision at
birth; later retries cannot attach or replace that authority. Search, reservation,
submission and file publication recheck the current exact choice. Copying and
hashing prepare an operation-owned partial outside PostgreSQL locks; accepting
staging rechecks the whole attempt under those locks before bounded filesystem
effects. Before copying, preparation refuses an existing partial without proof
of creation; a path or matching checksum does not authorize replacement. Newly
completed copies retain a journal acknowledgment of their exact native file
identity. A fresh invocation can reuse an acknowledged partial only after
rechecking its source, bytes, inode, timestamps and ancestors. Unacknowledged,
foreign or incomplete partials require explicit owner recovery and are never
overwritten by staging retries. Exact local publication invocation expiry uses
the existing bounded Temporal Activity retries; each retry reacquires current
authority with its own original sixty-second limit. Current
Plex access has a process-local expiry guard checked after final awaited work,
alongside the existing storage and execution deadlines. Previously committed
receipts and exact recorded compensation retain their separate recovery paths.

Opted-in ordinary staging partitions the original immutable plan into private
batches. Each batch rechecks the whole plan, current coordinator and complete
acquisition authority; final publication still verifies every file's bytes.
Torn or unacknowledged partials and changed acknowledgment identities remain
protected and require owner recovery.

Personal movie Network activities renew stale Plex access through the existing
registered account or managed-profile credential before checking current choice
authority. Renewal retains the immutable birth actor/subject pair, the shared
100-record allowance and the invocation's original deadline; it creates no
browser session or new consent. Search uses its recorded request; the one-target
due page and independent caption discovery use only live choices of the exact
edition scope. Download recovery renews the retained birth pair before queueing
a continuation of the same attempt and torrent. Loss of access still blocks
forward work. Library-management births, committed receipts and inverse recovery
keep their existing authority boundaries.

The version-4 public movie API starts exact-edition acquisition for new choices.
The UI uses it for requests, cancellation, choice revocation and edition lifecycle
actions. Existing version-3 choices need an explicit activation of the same
request, immutable choice and revision; activation preserves their original
command acknowledgements. An uncertain browser response retries the original
reviewed command, while a version conflict requires another review.

| Route                                                              | Contract                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v4/media/:id/movie-edition-context`                      | Current choices, activation requirements and admission reasons.                                                                         |
| `GET /api/v4/movie-requests`                                       | Paginated exact-edition fulfillment and personal protections, including redacted rows when library access is unavailable.               |
| `GET /api/v4/media/:id/movie-editions/:edition`                    | Edition state, own holds, allowed actions, safe file/caption summary, bounded recorded transfer history and owner removal confirmation. |
| `POST /api/v4/media/:id/movie-requests`                            | New explicit edition choice and scoped acquisition intent.                                                                              |
| `POST /api/v4/media/:id/movie-requests/:requestId/activate-choice` | Start the exact existing saved choice after current permission and version checks.                                                      |
| `POST /api/v4/media/:id/movie-requests/:requestId/cancel`          | Cancel the exact personal request, including older requests without a saved choice.                                                     |
| `POST /api/v4/media/:id/movie-requests/:requestId/revoke-choice`   | Clear the live choice while preserving request protection and immutable history.                                                        |
| `POST /api/v4/media/:id/movie-editions/:edition/actions`           | Scoped Keep, pin, unpin, restore, removal, retry and release selection.                                                                 |

Owner removal reviews the selected edition's complete current file set and moves
its video and owned captions to recoverable quarantine. It does not authorize
permanent deletion without retention consent. Owner-only Keep and pin preserve
quarantine when no personal or library demand remains; an explicit Restore can
restore those bytes without manufacturing a personal request or monitoring policy.

The v4 movie producer appends `MovieReleaseAssessment` records rather
than replacing provider snapshots. Each assessment binds the original source
digest, one movie edition, canonical metadata, parser version and immutable
quality-profile version. This allows a result previously rejected by the older
title parser, including one first discovered for another movie, to receive a
new interpretation without changing its original attributes, query coverage or
acquisition receipts. PostgreSQL protects both the assessment and its referenced
provider snapshot from modification. Concurrent equivalent observations reuse
the first literal assessment; profile or catalog changes create another record.
Version-2 movie acquisition identities bind an exact assessment ID and hash.
These assessment contracts are internal; the public v3 routes above retain their behavior.

Scoped v4 acquisition commands dispatch to dedicated movie coordinators. Discovery,
reservation and transfer observation run on the Network queue; inspection,
staging and publication run on Files; exact Plex verification and finalization
return to Network. Each worker captures its original execution before lazy
initialization. A quota-bearing add has one automatic attempt, and an uncertain
outcome remains observation-only. Imported/completed attempts resume from their
actual publication receipts. A prepared publication whose consent changes stays
under reconciliation. Workflow inputs and results carry scoped IDs and status,
while source data, file plans and credentials remain inside Activities.

Within the current authorized ownership epoch, cancelling a v4 request or
revoking its reviewed choice releases that attempt's
exact edition reservation when no file publication is prepared. Its original
request/choice identity and acquisition birth remain unchanged. An in-flight or
uncertain torrent add retains its reservation until its outcome is recorded;
recording a successful prior add preserves independent seeding responsibility
before releasing a cancelled request's reservation. Prepared or imported file
publications retain their reservation for their existing recovery path. These
transitions do not remove files, remove transfers or change another cut's intent.
Cancellation remains available while ownership is paused; reservation settlement
waits for authorized acquisition reconciliation in the same epoch.

Requester watch observation can select the exact edition of a currently serving
movie. Acquired and initial-library files use their actual current Plex binding;
the requester response must retain the same item, cut label, GUIDs and Part.
Observation fences, known/unknown projections and unwatched intent changes stay
within that edition. Unknown metadata clears the bound value without crediting
another cut, and an older batch cannot overwrite a newer observation.

Scoped movie retention evaluates the selected target's generation, complete
requester cohort, holds and current serving binding. Each requester needs a
fulfilled choice for that cut and fresh authenticated watch evidence. Requests
and holds for another edition retain their own authority. Unclaimed files and
unresolved household request-history holds remain protected.

Version-3 movie history reviews address one exact cut of an adopted
library movie. They reuse the existing recovery review, response and release
tables, with distinct scope and accounting envelopes. Each applicable household
member supplies their own declaration; a current owner may act for a verified
managed profile. Requests, edition choices, cancellations and Keep decisions must
already exist through their actual commands before the review captures them.
Releasing a review creates none of those decisions. It clears only the selected
history hold, advances that target's generation, cancels its stale removal
warnings and queues scoped retention evaluation. Library monitoring, physical
ownership, Plex binding and original adoption records remain unchanged.
Optional Seerr claims require actual requester identity bindings and exact-cut
accounting; unresolved claims continue to protect the file. Independent accounts
map to their confirmed server account with no managed Home-profile identity.
Historical unversioned and version-2 recovery scopes retain their original
readers and cannot consume the version-3 accounting envelope.

The owner opens household history from the selected movie edition. Each person
finds their pending declarations in Recovery review, with only their own captured
request, choice and Keep lineage. The review page is `/recovery/movies/:id`.
Declarations are immutable; changed requests or protections need a new capture.
The owner releases the exact reviewed household response set after confirming
the missing-history baseline and existing pins. Unknown browser writes retain
their original actor, scope, body and idempotency key across a background refresh.

The review page says first where the review stands (who it waits for, ready to
release, released, or closed), then gives each person the owner may declare
for one declaration form. The three declarations are radios that say what each
records; one that is not open, such as Keep with no captured hold or "no longer
request" while a request is active, is shown disabled with the reason. A Keep
declaration then asks for which captured hold it uses. The owner sees who has
declared and, once everyone has and nothing blocks the review, the release: three
statements, then a dialog that names the film. A refused write says that nothing
was recorded; one whose result was never acknowledged offers "Retry original
action", which sends the same command again. Raw identifiers and hashes are under
"Technical details" for the owner only. A member's own page carries none of the
household's declarations.

Version-4 removal warnings retain the selected edition and original decision's
Plex projection. Delivery rechecks watch evidence, Keep, generation and configured
access after its durable claim. Receipt reconciliation preserves the original
warning and acceptance; quarantine eligibility follows seven full days of grace.
The original SDK, writer, storage and mapping deadlines remain in force across
the evaluation and send. Historical default warning bodies remain literal.

Quarantine moves the exact video and its owned caption files through the existing
filesystem journals. Its scoped receipt retains the original decision, manifest
and Plex projection before retiring that binding. Quarantined requester reads
use this committed parent; they cannot borrow a serving pointer from another cut.
Purge requires a further seven days from the actual quarantine commit and fresh
watch, warning, hold and ownership checks. A later retention command can continue
the same decision. Missing bytes without that purge's own journal remain protected.
Database settlement failures resume the same physical journals.

Restoration records an actual physical successor without changing acquisition or
initial-library history. It restores the same video and captions, then verifies
the original Plex item and Part before publishing a fresh binding. A separate
rebinding timestamp preserves the asset's original publication time. Subtitle
work and later upgrades follow the exact restored version and its receipt;
restoring the serving copy does not renew an earlier upgrade's rollback deadline.
Logical completion queues current caption requirements and personal availability
notices without creating a transfer or seeding record.

The periodic watch sweep follows its existing default/TV phase with ordered
available and quarantined named movie targets. Each Activity observes one complete
cohort using its original provenance allowance, then continues its cursor.
Initial-library files use their actual adoption binding without constructing
acquisition history. Plex hints resolve the exact current item claim. Version-2
movie associations, including the unmarked choice, queue scoped v4 watch and
retention work; version-1 associations retain their original payloads and hashes.
Each hint checks its stored operation, generation, epoch and binding before reading
the requester's current metadata. A scrobble event alone never proves watched
state. An authenticated unwatched observation of quarantined v4 bytes remains
observational after released interest; explicit renewed interest queues
restoration for that exact edition.

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

New scoped movie acquisition histories call `prepareMoviePublicationV4` after
staging, then publish through the existing Files Activity. Preparation commits
the same literal version-2 intent and complete predecessor/caption authority
without changing library assets or captions. Publication rechecks current
authority and follows that exact committed intent. Each actual Activity retains
its own original SDK deadline and one 100-record allowance; neither phase resets
an allowance within an invocation. The `movie-publication-preparation-v1` history
marker preserves the original Activity sequence for older executions.

The `movie-publication-rollback-v1` acquisition history branch uses
`publishMovieWithRollbackV4` to retain an actual protected Plex observation before
requesting rollback. Files first commits private rollback admission, then a
separate Activity restores the predecessor through the existing causal file
journal. Both phases carry the actual Workflow and run identity and their own
original SDK capability and provenance allowance. A missing negative observation
or a successful successor Plex receipt protects automatic rollback. The original
acquisition, publication outcome, Plex receipts and publication timestamps remain
literal. Fresh Network verification must prove the predecessor's original item
and Part before restoring serving authority; the failed upgrade remains blocked.
Recorded rollback admission routes retries through inverse recovery before any
forward publication. Histories preceding this marker keep their recorded
publisher and failure behavior.

The separate owner command `rollback_movie_edition_v1` reviews the currently
served successor, its retained predecessor, the exact Plex binding and the
original cleanup window. `PrismaMovieRollbackCommandsV1` checks the current
owner's own Plex permissions and compares those reviewed versions before
queuing a new operation. It does not borrow the upgrade requester's consent or
extend the cleanup deadline. The private command retains the reason and review;
the `rollbackMovieEditionV1Workflow` outbox projection carries only its new
operation ID, source attempt ID and movie scope. The workflow requires fresh
Network playback observations before admission and again before physical
restoration. Files admission must win the original cleanup race before any
inverse effects. Completion belongs to this
new owner command, while the original successful acquisition remains literal.

The owner opens **Recover the previous file for this edition** from the selected
movie's controls. `GET /api/v4/media/:id/movie-editions/:edition/rollback`
returns the eligible file pair and its original deadline; the matching `POST`
requires that exact review, a reason and separate confirmations to restore the
predecessor and retain the rejected successor. A queued command is shown as in
progress before Files admission. Unknown executor state remains protected.
Browser retries retain the original actor, reviewed body and idempotency key;
a changed pair or binding requires a fresh review.

An admitted rollback can resume after its exact previous Workflow run reaches
a terminal state. Owner retry creates a distinct command and executor, with an
immutable handoff event and a compare-and-swap of the original operation's
current executor. Running or unknown runs remain protected. Each Activity
rechecks current permissions and playback under its own SDK deadline; the
original intent, file journal, acquisition history and cleanup window remain
unchanged. An interrupted automatic rollback also requires a fresh complete
playback observation before the owner resumes its inverse.

The internal v4 Plex publisher verifies complete stable server inventories and
exact metadata readbacks before advancing the selected edition's availability.
Its version-2 movie association includes the registered edition title as well as
the exact movie identity, section, file Part and physical asset. A matching movie
GUID cannot substitute another cut or a merged file. Successful publication
records a distinct immutable completion and verified timestamp; retries read that
receipt before current configuration. Matching requests can be fulfilled from
this exact named association without changing an older request acknowledgement.
Historical version-1 Plex observations retain their literal format and hashes.

Movie finalization consumes that actual Plex receipt and the current scoped
serving binding. It completes the imported attempt, releases its edition's
reservation, reuses the Media-created transfer's seeding command and queues that
cut's subtitle requirements in one transaction. An unverified publication or
expired invocation/writer authority cannot advance finalization. Completed
retries validate the original publication before consulting current
configuration; they do not repeat downstream work.

Movie publication notices use a separate version-4 body tied to the actual Plex
receipt, physical asset and recipient's immutable edition choice. They reuse the
delivery-attempt journal while checking current consent, generation, library
access, preferences and serving bindings before claim and send. The original
SDK, writer and Plex mapping deadlines span both phases; refreshing a lease or
mapping cannot extend them. Source and recipient selection are immutable, and
receipt reconciliation does not authorize another send. Email subjects and
bodies retain the selected edition label. Older default-only event bodies retain
their existing semantics.

Movie caption-ready notices use the actual caption installation receipt and its
original video parent, including an initial library adoption with no acquisition
attempt. Both caption installation and serving publication check for completed
requirements, so either completion order queues the same readiness notice.
Household policy alone does not create personal notification consent. Delivery
rechecks the current cut's complete requirements and serving binding while
retaining the source receipt and one invocation-wide provenance allowance.

The internal movie subtitle protocol carries version-4 operation IDs, asset IDs,
exact edition scope and a current target digest. Named editions inherit the
canonical movie's household subtitle policy when no edition override exists.
An explicit empty override is honored; malformed rules and unconfirmed epochs
remain protected. Personal subtitle targets require current edition consent.
Caption progress does not change the digest for a sibling target.

Tracker configuration can capture source priority, minimum seeders, a first-seen
delay and highest-allowed-quality bypass. Admission and final reservation use the
same policy, and delayed sources receive a durable outbox recheck. Mutable native
availability observations live separately from immutable assessed release bytes;
observations older than 30 minutes cannot establish a positive seeder floor.
Pirate Bay feeds consume its actual bounded recent snapshot without fabricating
pagination. Existing transfer ownership and seeding obligations are unchanged.

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

Providers without a forced flag retain `forced: null`. A regular English or
Simplified Chinese target can use that candidate only after the Files worker
measures speech independently from the owned video's first audio stream and
proves caption coverage throughout the video. The proof binds both content
digests; sparse forced captions do not satisfy the regular target. A dedicated
patched Activity performs this work without changing retained installation
deadlines. Its private speech reference also supplies ffsubsync timing with the
configured 60-second maximum offset and frame-rate correction disabled. Original
caption bytes remain recoverable when a synchronized candidate is accepted.

Movie caption installation stages validated bytes outside PostgreSQL and checks
current scope, policy, consent, runtime, storage and physical publication before
the library write. Writer, storage and requester observations captured before
staging keep their original expiry through final publication. Identical
unmanaged destination bytes require owner review.
A distinct immutable completion binds the actual installation journal, original
invocation/SDK deadline, caption facts and physical video parent. Completed
retries acknowledge that record before dynamic configuration. Later publication
lineage follows the actual caption completion using the caller's shared
100-record allowance. Scoped caption commands dispatch to their own Workflow:
Network finds or reuses the candidate and Files installs it. A validated embedded
track still needs that installation step; it does not consume a provider download.
Quota-bearing lookups use the durable download journal and one automatic attempt.
Public v4 routes remain closed until the downstream lifecycle is complete.

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

Both `test` and the CI step (`ci-tests.json`) give every test and hook a
60-second limit instead of Vitest's 5-second and 10-second unit defaults. An
integration journey starts PostgreSQL and file tools and can take several
seconds alone, and longer while `verify` shares the pod with other suites. Its
simulated authority clocks are the assertions; the wall-clock limit only
catches hangs. Keep both copies of the flags in sync.

Media inspection tests also require `ffmpeg` and `ffprobe` on `PATH`; the CI and
Temporal images install them. The repository's mise configuration supplies the
upstream `7zz` command used for bounded subtitle archive extraction.

### Fixture mode and browser tests

The web client runs without Plex, PostgreSQL, or Temporal against a read-only
fixture API in `src/testing/fixture-api`. It serves about sixty titles covering
every availability, keeping policy, and request state, as a library owner or as
a household member.

| Command                                              | What it does                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `bun run dev:fixture`                                | Vite dev server over the fixture API, on a free port it prints. Runs in the foreground.      |
| `bun run dev:fixture -- --port 7400`                 | The same on a chosen port.                                                                   |
| `bun run dev:fixture -- --persona member`            | Signs in as the member. `MEDIA_FIXTURE_PERSONA=member` does the same.                        |
| `bun run test:e2e`                                   | Builds the client and runs the Playwright suite in `e2e/browser` against the fixture API.    |
| `toolkit screenshot media /library`                  | Captures one route in fixture mode. Add `--env MEDIA_FIXTURE_PERSONA=member` for the member. |
| `bunx turbo run test --filter=@shepherdjerred/media` | Includes the fixture contract test, which needs no database.                                 |

A running fixture server switches persona without a restart: open
`/api/fixture/persona/member` or `/api/fixture/persona/owner` and the browser is
signed in as that persona until it switches back.

A scenario puts the fixture API in a condition a page only shows when something
outside it is wrong. Open `/api/fixture/scenario/<name>` to choose one for the
browser (it sets the `media-fixture-scenario` cookie, which a browser test sets
directly) and `/api/fixture/scenario/default` to leave it:

| Scenario               | What the fixture API does                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `stale-library-access` | Every catalog read reports `libraryAccess: "stale"` and no title carries a `library`.                  |
| `feed-unavailable`     | The `popular_series` feed answers 502 `catalog_unavailable`; the rest keep working.                    |
| `catalog-unavailable`  | Every catalog read answers 502 `catalog_unavailable`, as when TMDB is down.                            |
| `new-household`        | A household on its first day: every list is empty and no catalog title is held.                        |
| `library-unavailable`  | `GET /library` answers 500 `internal_error`; every other read keeps working.                           |
| `recovery-long`        | A restore with 42 held titles, three open household reviews (one of 26 episodes) and ten applied ones. |
| `recovery-all-clear`   | A restore that has been dealt with: nothing held, every household review applied.                      |
| `recovery-unavailable` | `GET /recovery` answers 500 `internal_error`; every other read keeps working.                          |

A fixture answers a scenario by reading `request.scenario`, and throws
`FixtureFailure` (`src/testing/fixture-api/scenario.ts`) for an error the real
API sends. `new-household` empties the reads Home, the Library and the Calendar
are made of (requests, interests, film requests, the library, the calendar,
removals, what is playing, the watch history, notifications, what a restore left held, and the owner's migration captures and library reports), which is how Home's
welcome is seen; `library-unavailable` is one of Home's sections failing among
the others.

The calendar fixtures are by day of the current month, plus a few releases in
the seven days from today (`WEEK_AHEAD` in `fixtures/calendar.ts`), so the week
Home shows is never empty at the end of a month.

The fixture API answers reads only. A write returns a typed `501`, an unknown
path returns a typed `404` and is logged, and an owner-only route returns `403`
to the member, so a page that depends on something unstubbed shows its error
state instead of invented data.

`src/testing/fixture-api/endpoints.ts` is the single table of routes. Each entry
names the path, the schema the client parses that response with, the fixture
that answers it, and sample requests. The router serves only that table and
`endpoints.test.ts` parses every sample with its schema, so a contract change
fails the unit test rather than rendering an error notice in the browser. Add a
fixture by adding an entry; a new client read with no entry fails the browser
suite with a `404`.

The browser suite opens every member route and every Manage page that has a
fixture at 1440 and
390 pixels wide, in the light and the dark color scheme. It fails on an error
notice, a console or uncaught error, a failed API response, a request to any
other origin, a Content-Security-Policy violation (see
[Security headers](#security-headers)), a wrong document title, or a WCAG 2.2 AA
violation, color contrast
included, that `e2e/browser/axe-baseline.ts` does not list. That baseline is
empty and compared exactly; nothing may be added to it to make a new violation
pass. Routes the fixture API cannot answer yet are listed in
`e2e/browser/routes.ts`. `e2e/browser/shell.spec.ts` drives the shell itself:
search, the account panel and theme, focus after a navigation, and every address
that moved.

A spec runs in both projects, `desktop` and `mobile`, unless its name says which
layout it is about: `*.desktop.spec.ts` (the sidebar) runs only in `desktop` and
`*.phone.spec.ts` (the tab bar, and Manage in the account panel) only in
`mobile`. Put a
layout-specific test in one of those files instead of skipping it by viewport;
the root quality ratchet rejects `test.skip`.

`e2e/browser/manage/forms.spec.ts`, `durations.spec.ts`, and
`quality.spec.ts` drive the owner's forms. Because the fixture API refuses
writes, each test answers the
write itself (`answerWrites` in `manage/support.ts`) and asserts the method,
path, headers, and body the client sent. They prove what would be requested,
not that anything was saved; a write against a real server is covered by the
server's own suites.

The suite runs in Woodpecker's browser lane with the other Playwright targets,
not in the `ci` or `extended` Vitest tiers.

### Client shell and routes

`src/client/shell/routes.tsx` is the one route table, used by `main.tsx` in a
browser router and by the session tests in a memory router. Its root element is
the session gate in `app.tsx`: the sign-in page until a session is known, then
the shell (`shell/shell.tsx`) around the matched page. The shell is keyed by
session generation, so a changed principal never keeps a mounted page.

Everyone gets Home, Discover, Library, Calendar, and History, in the sidebar
and, on a phone, as the five tabs along the bottom (`shell/navigation.ts`). Home
is `/`, the index route, and the logo leads to it; its item is marked only at
its own address, because every address starts with it. Notifications are reached
from the bell in the top bar, which carries the unread count, and notification
settings and recovery reviews from the account panel, because members use all
three. The owner also gets Manage: in the sidebar, and on a phone in the account
panel, because five tabs are what a phone's width holds. It is one page per
topic under `/manage`:

| Address                               | Page                                             |
| ------------------------------------- | ------------------------------------------------ |
| `/manage/household`                   | Who can make requests                            |
| `/manage/quality`                     | Living-room guide and quality profiles           |
| `/manage/subtitles`                   | Subtitle upload                                  |
| `/manage/subtitles/replacements/:id?` | Subtitle replacement reviews                     |
| `/manage/plex`                        | Plex identities                                  |
| `/manage/numbering`                   | Anime absolute numbering                         |
| `/manage/providers`                   | Providers and seeding policy                     |
| `/manage/activity`                    | Operations                                       |
| `/manage/recovery`                    | Recovery: reviews, held titles, and file proofs  |
| `/manage/recovery/native/:id?`        | Native file recovery, archives, and compensation |
| `/manage/migration`                   | Migration captures and library import            |

Each Manage page is a lazy route, so its code is a separate chunk that a member
never downloads; a member who opens a Manage address is sent to Home, as is
anyone who opens an address that does not exist.
The whole client still ships one stylesheet (`build.cssCodeSplit` is off),
because the cascade layer order is fixed by the first `@layer` a browser reads.

The Library is one page with four views, each a route beneath `/library`:

| Address            | View         | Shows                                                                        |
| ------------------ | ------------ | ---------------------------------------------------------------------------- |
| `/library`         | All          | Every title the household has, as a poster grid or a compact list.           |
| `/library/mine`    | Mine         | What the reader asked for, one entry per film or series, with every control. |
| `/library/leaving` | Leaving soon | What is about to leave, for the whole household, with the 30-day hold.       |
| `/library/removed` | Removed      | What left and why, with restore for whoever may still use it.                |

Addresses that moved redirect, keeping their path parameters, query string, and
fragment: `/admin` to `/manage/household`,
`/admin/migration`, `/admin/subtitle-replacements/:id?`, `/recovery/native/:id?`,
and `/activity` to their Manage pages; `/requests` to `/library/mine`,
`/removals` to `/library/leaving`, and `/removed` to `/library/removed`.
Notification emails, Discord messages, and OAuth returns carry client addresses,
so a route may move only if its old address is added to `movedRoutes` in the
route table; `shell/routes.test.tsx` lists the addresses the server writes.
`/requests?interest=<request id>`, which every "still watching?" reminder
carries, lands on Mine with that request's entry scrolled into view, marked, and
its controls open.

After a navigation the shell moves focus to the new page's heading, which is why
every page renders its heading through `PageTitle` (the title page's hero
renders its own, focusable the same way). A switch between views of
one page is the exception: a link that carries the `SAME_PAGE` state
(`ui/same-page.ts`), as every `Segmented` link does, leaves focus on the control
and the scroll position where it was.

The top bar holds the client's one search field. From any page, Enter opens
`/discover?q=` with the search. While Discover is the page open, the field also
searches as it is typed in, 300 ms after the last keystroke: the first search
adds a history entry, so Back returns to the browse rows, and each refinement
rewrites it. Text an input method is still composing is not searched for, and
starting a composition drops a search that was waiting to be sent; the finished
text is searched for when the composition ends. A typed search belongs to the address it was typed at: if the reader goes
anywhere else before the 300 ms are up (another page, Back, "Clear search"), it
is dropped instead of undoing what they did.

### Home

`/` (`src/client/home/`) answers "what is waiting on me, and what is new for
me?". It is six sections, each from its own read, and a section whose read has
nothing in it is not on the page:

| Section            | Read                                              | Shows                                                                                                                                               |
| ------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs your answer  | `GET /request-interests`; `GET /recovery` (owner) | The reader's own open "still watching?" checks with the three answers Mine gives, and for the owner each open household review and the held titles. |
| Now playing        | `GET /playback/now-playing`                       | Current streams (the household's for the owner), each linked to its title when the session carries `media`. Nothing while the read is `stale`.      |
| On the way         | `GET /requests`, `GET /request-interests`         | The reader's own active requests they still follow that have not all arrived, one entry per film or series, furthest along first.                   |
| New in the library | `GET /library?sort=added`                         | The first 20 titles as a `PosterRail`; "See all" opens the Library sorted the same way.                                                             |
| This week          | `GET /calendar` for today and the six days after  | Dated releases a day to a column, as the Calendar's own rows; at most twelve, with the rest counted and left to the calendar.                       |
| Leaving soon       | `GET /removals`                                   | The three titles that leave first, each with the Library's own 30-day hold, including "Keep all N episodes".                                        |

`home/model.ts` turns each answer into what its section shows, as pure
functions. Where one can fail on an answer the client does not understand (a
removal or review state it has no words for), it runs as the query's `select`,
so that section fails and the page does not.

Each read is its own query (`home/reads.ts`), so each section loads on its own
and fails on its own, with an `ErrorState` and "Try again" under its heading;
the other sections are untouched. While it loads, a section that usually has
content (On the way, New in the library, This week, Leaving soon) holds its
place with a skeleton. Needs your answer and Now playing are empty for most
people most of the time, so they hold none: a heading that came and went on
every visit would say something had been there. They appear when their read
brings something. Requests,
interests, the library sorted by arrival and removals are read through
`library/reads.ts`, the definitions the Library's own views use; the week's
releases through `calendar/reads.ts`, the Calendar's read, for seven days
instead of a month; and what is playing under History's key. So an answer
another page has is not asked for again and a change made on one refreshes the
other. Home asks again for requests and what is playing once a minute, and for
removals as often as the Library does; nothing on it refreshes faster than the
page it shares with.

"This week" is built from the Calendar's own parts: `releaseDays` sorts the
releases onto their civil dates (`calendar/events.ts`), `calendar/dates.ts`
does the date arithmetic and wording, and each day's list is the Calendar's
`ReleaseList` (`calendar/release.tsx`), so a release reads the same on both
pages.

"Leaving soon" is the Library's own control too: `LeavingKeep` and the
`useKeepRuns` hook behind "Keep all N episodes" (`library/leaving.tsx`), over
the same entries (`library/keep-run.ts`). Home lists the three titles that
leave first and any other a run has a report on, and the page holds the runs,
so a report stays until it is dismissed even when its title has left the list.

"On the way" counts a series by its episode requests where it has them (a
series request fans out to one per episode, and the episodes are what arrive),
and otherwise says what the request itself says. "N of M episodes ready to
watch" counts only episodes that can be played: one that is set aside or gone
is neither ready nor on its way. Its steps are worded in
`presentation/progress.ts`, finer than the Library's one "On the way".

A request stays `active` after the reader finishes it or stops following it,
so the reader's interests decide what is listed, by the rule Mine uses
(`releasedInterest` in `library/mine-model.ts`): a request whose interest is
not `following` is not on the way, however far along it is. A season or
episode that a request fans out to carries no field saying which request
covers it, so those rows are judged by their title, as Mine groups them: they
stay while any request on the title is still followed. The section waits for
both reads before it lists anything, so a released title never shows and then
disappears.

A check answered on Home stays where it was as its own confirmation, in the
words of the button that sent it (`INTEREST_DONE_COPY`), until the reader leaves
the page. The owner's two items link to `/recovery` and `/recovery/:id`; Home
decides nothing about a restore. A member's recovery reviews are not listed:
the list read does not say whether the reader has already answered one.

When every read has answered and no section has anything (the `new-household`
fixture scenario), the page is a welcome that says what it will show and leads
to Discover. It waits for every read, the two that hold no place included: an
absent section is not yet an empty one, and a read that failed shows its
failure instead.

### Discover

`/discover` (`src/client/discover/`) is where a title is found and where the
household's state of it is first seen. What it shows is in its address:

| Address            | Shows                                                   |
| ------------------ | ------------------------------------------------------- |
| `/discover`        | One row per feed of `GET /api/v1/catalog/discover`.     |
| `/discover?q=dune` | The results of `GET /api/v1/catalog/search`, as a grid. |
| `/discover/:feed`  | One feed, all of it, as a grid.                         |

`:feed` is `trending`, `popular-films`, `popular-series`, `airing-this-week` or
`upcoming-films` (`discover/view.ts` maps them to the API's feed names); an
address that names no feed opens `/discover`.

A row is the first page of its feed in a `PosterRail`; "See all" opens the feed.
A grid loads one catalog page (20 titles) at a time, up to the five the API
offers. Both read through `useCatalogList`, which follows page numbers with
`useCursorList` and shares one cache entry per feed between the row and the
grid.

Each card is one link: to `/media/:id` for a title the household has (`library`
carries its `mediaId`), otherwise to `/catalog/:kind/:id`. The request itself is
made on that page, not here. `discover/card.ts` turns the `library` annotation
into what the card says:

| `library`                                   | Card                                                       |
| ------------------------------------------- | ---------------------------------------------------------- |
| `null`, `libraryAccess: "current"`          | "Request", drawn as an offer and not as a state.           |
| `null`, `libraryAccess: "stale"`            | No phrase at all.                                          |
| a film (`availability`)                     | The library's phrase for that availability.                |
| a series with `episodes`                    | "3 of 10 episodes", "Ready to watch" or "No episodes yet". |
| a series with `episodes: null`              | "In the library": the count is unknown, not zero.          |
| `myInterest: "following"`                   | Also "You follow this".                                    |
| `requested`, and the reader does not follow | Also "Others follow this".                                 |

A title that is not out yet shows the day it arrives in place of its year.

When any page read answers `libraryAccess: "stale"`, the page says once, above
the titles, that Media could not confirm the reader's Plex access, and offers
"Check again", which re-reads every catalog list. The access is the page's own
(`useCursorList` keeps every page as it was answered, in `pages`), so it is said
over a search or a feed that came back with no titles too. Each title also keeps
the access of the page it arrived on, because a later page can come back stale
after an earlier one was current.

A feed that answers 502 `catalog_unavailable` fails in its own row, in the room
its rail would have taken, with "Try again"; the other rows and search are
separate reads and keep working. When every feed fails the page explains it
once instead of five times.

### Library page and client primitives

`/library` shows every title the household has as a poster grid
(`src/client/library/`). Search, the kind, keeping and readiness filters, the
sort and the layout are query parameters (`q`, `kind`, `keeping`, `status`,
`sort`, `view`), so a view can be linked and survives a reload; a value the page
does not know reads as that setting's default. `view=list` is the compact list,
which is where the owner switches a title between kept for good and kept just
for now.

Mine joins three reads by request id (`library/mine-model.ts`): the rows of
`GET /requests`, which name the title each belongs to (`rootMediaId`,
`rootTitle`); the reader's request interests, read with `include=artwork`; and
their film requests. The two paged ones are read to the end first, because a
join over part of a list would show a request without its controls. A row is
something a person asked for when it has an interest or a film request of its
own, or is for the film or series itself; every other row is a season or episode
such a request covers, listed under it on demand. A film whose library details
the reader may not see is listed without its name or poster. Each list reads its
rows' default-target views in one batched request.

The names of the Library's views and of the buttons a message tells a person to
use live in `src/shared/household/names.ts`. The client's labels and the two
messages that send someone to the Library to act (the "still watching?" check
and the leaving warning, worded in `src/automation/notifications/copy.ts`) both
read them from there, so a message cannot name a page or a button that is not
on screen. Those messages still link to `/requests` and `/library`, which is why
those addresses must keep working.

Leaving soon groups the pending rows of `GET /removals` by `rootMediaId`
(`library/removals.ts`). A series losing several episodes gets one "Keep all N
episodes" action (`library/keep-all.ts`), which sends the existing per-episode
`keep` command for each in turn and reports every outcome: one failure never
stops the rest or hides what succeeded, and trying again sends only what failed,
repeating the same command (and so the same idempotency key) when the earlier
result is unknown. A run is about the rows it started with
(`library/keep-run.ts`): the list is read again after every run and drops each
kept row, so the report's counts, its per-row results and its retry come from
the run, not from the list on screen. A report with a failure stays until the
reader dismisses it; one that kept everything goes when its rows leave the list.

Rows whose files have already left are not leaving; Removed lists them from the
same read. `GET /removals` holds only decisions about a title's default version,
and the restore control restores that version, so in the removal history the
control goes on the row whose `id` is a listed removal's `id` (both are the
retention decision's id), never on a row that merely shares its `mediaId`: a
film's default version and one of its cuts can be set aside at the same time,
and the cut is recovered from the title page.

`GET /removal-history` cuts a page of the household's removals first and keeps
the reader's own afterwards, so a member's page can be short, or empty, and
still carry `nextCursor`. An empty page is therefore never taken for the end of
the history. Removed reads with `emptyPages: "skip"`: each look (the first, and
each "Show earlier removals") follows the cursor past empty pages until one has
something to show or the history ends, up to five pages. Five empty pages in a
row with more behind them is where a look stops: the view then says that none of
the most recent removals were the reader's and offers "Look further back", so a
long run of other people's removals costs a bounded number of requests and never
reads as "nothing has been removed". The fixture history is filtered the same
way, and its five newest removals are all other people's, so a member's first
page is empty in `dev:fixture` too.

Shared building blocks live in `src/client/ui/`:

| Module                       | Holds                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `poster.tsx`, `artwork.ts`   | A 2:3 poster from the artwork route, lazy unless a page opens on it, with a `srcset` of the proxy widths; no image shows the title instead. |
| `poster-card.tsx`            | `PosterCard`, `StatePill`, and `PosterGrid`, whose column count follows its own width (container queries).                                  |
| `poster-rail.tsx`            | `PosterRail`, a row of cards that scrolls sideways with scroll snap, and what stands in for one that failed.                                |
| `section.tsx`                | One part of a page with several: a heading, an optional "See all" beside it, and `--section-gap` for its spacing.                           |
| `segmented.tsx`              | A row of exclusive views that are links, so navigation and not an ARIA tablist.                                                             |
| `choice.tsx`                 | `Choice`, a native select drawn as a chip, marked when it narrows the list it sits above.                                                   |
| `search-field.tsx`           | `SearchField`, a search box whose text lives in the page's address.                                                                         |
| `date-field.tsx`             | `DateField`, the browser's date field as a chip beside `Choice`.                                                                            |
| `skeleton.tsx`, `states.tsx` | Loading shapes, empty states that say what to do next, and error states by kind of failure.                                                 |
| `use-cursor-list.ts`         | The one place the client follows `nextCursor`: a page at a time, past empty pages, or every page.                                           |
| `use-media-query.ts`         | Whether a media query matches, for the rare choice between two layouts whose markup differs.                                                |

`src/client/presentation/` holds the words for contract enums, each table
written `satisfies Record<Enum, …>`: an enum that gains a value stops compiling
until it has copy, and no table has a fallback. A page shown to a member takes
its wording from there, never from `humanize()` or a raw enum name.

In fixture mode the artwork route draws a small PNG per file name
(`src/testing/fixture-api/fixtures/artwork-image.ts`). Some fixture titles have
no stored artwork, and the poster of "Your Name." answers 502, so both ways a
poster can be missing are on screen.

### Title page and request sheet

One page (`src/client/title/`) serves both title addresses. `/media/:id` is a
film, series, season or episode the household has; the server writes that
address into emails and notifications. `/catalog/:kind/:id` is a film or series
by its catalog identity: one the household already has redirects to its
`/media/:id`, and any other is shown from the catalog read alone and can only be
asked for.

The page opens on a hero (backdrop, poster, title, one state phrase, synopsis)
and one primary action chosen from where the reader stands with the title.
`primary-action.ts` is that choice as a pure function of facts the reads report
(`facts.ts`); it invents no permission:

| The reader's standing                                                     | Primary action                      |
| ------------------------------------------------------------------------- | ----------------------------------- |
| The files are removed and the reader may bring them back                  | Restore                             |
| A removal is under way and the reader may hold the title                  | Keep for 30 days                    |
| The reader has a request and still follows the title                      | Following, which opens the menu     |
| The owner, on a film or series the household can watch, kept just for now | Keep for good                       |
| The owner, on a film or series the household can watch, kept for good     | Kept for good, which opens the menu |
| The owner, on a season or an episode the household can watch              | Keep for 30 days                    |
| Anything else                                                             | Request                             |

Everything else the reader may do is in the menu beside it. A series, season or
episode is acted on through the default-target read and its commands
(`allowedProtectiveActions`, `ownRequests`). A film is acted on one version at a
time through the movie-edition reads; the hero acts on the standard version and
a film with more than one version lists each under Versions with its own
actions. Members call an edition a version, and the unmarked edition the
standard version (`presentation/version.ts`).

Three things keep a title, and the page keeps them under three names:

- **Keeping** is the library's standing choice for a film or series: "Keep for
  good" or "Keep just for now", the owner's switch, named as the Library names
  it (`shared/household/names.ts`) and sent as the same
  `POST /library/:id/keeping-policy`. The switch position is
  `libraryKeeping.keepingPolicy` of the title read. `policy` is the label every
  reader gets, and it also says "keep" when a request keeps the title while the
  switch is off; the page then says whose request does. A season or an episode
  reports its series' keeping and has no switch of its own.
- **Keep for 30 days** is a hold anyone allowed may place. It stops a removal
  for a month and leaves the keeping choice as it is.
- **Pin so it never leaves** is the owner's own hold with no end, also on top of
  the keeping choice. It is never called keeping for good.

A hold is not offered for a title that is pinned or kept for good unless a
removal is already under way: there is nothing for it to stop.

There are two ways out of a title the reader follows, and the menu offers one:

- **Stop following** is the interest's `drop` command, as the Library's Mine
  view sends it, at the `interestRevision` the title read reports. It is the way
  out wherever the reader has an interest of their own in this very title that
  can be let go: their own request for it, keeping it just for now. The request
  stays on record under Mine, where "Keep watching" picks it up again.
- **Cancel request** withdraws the request itself. It is offered where there is
  no such interest: a season or episode that a request for the whole series
  covers (taking that part out), a version of a film other than the standard
  one (the read reports no interest for it), and a request that keeps its title
  for good, which the server refuses to drop. For that last one the page says
  what to do instead.

The title read lists only the requests that still follow the title, so after
"Stop following" the page says "Request" again. Both household commands
(`title/household-commands.ts`) wait for the title to be read again before they
report. A refusal the page expects is told in the reader's words on the page as
just re-read: a stale version or revision (`version_conflict`), and a request
that came to keep its title meanwhile (`keep_protected`).

Below the hero: who follows the title, how long the library keeps it and what
holds it meanwhile, a series' seasons (each opens onto its episodes, read when
first opened), a film's versions, and a closed "Files and subtitles". The hero
gives a film's or an episode's runtime where the read has one. `followers` names
who follows the film or series to owner and member alike, the reader as "You";
when the read withholds the list the line is left out, which is not the same as
nobody following.

The owner gets a second view, `?view=manage`, with one panel for each question
the owner asks about a title, in this order:

| Panel                             | Answers                                                               |
| --------------------------------- | --------------------------------------------------------------------- |
| Where it stands                   | Availability, upgrade monitoring, profile, requesters, holds          |
| What is happening now             | Whether it can be watched, each download and its seeding, attempts    |
| Change how it is acquired or kept | Retry, remove from library, the quality profile (a form)              |
| Change an edition (films only)    | One edition's file, keep, pin, restore, retry, remove, release choice |
| What files it has                 | Recorded files, their subtitles, media properties                     |
| Releases and how they were judged | Each release found, its verdict and reasons (not for films)           |
| What happened before              | The title's event history                                             |

A film is changed one edition at a time, so its release choice sits under Change
an edition, and the panels that describe "the title" describe the unmarked
edition. Raw records (media properties, a release's evaluation) are behind a
Technical details disclosure. Removing from the library, for a series and for an
edition, asks first in a dialog that names what will go. The panels are built on
`ui/panel.tsx`, `ui/data-list.tsx`, `ui/record.tsx` and the form primitives, and
send the same commands the page always has. `title/manage/manage-title.tsx` is
imported only through `React.lazy`, so those panels are a chunk (`manage-title`)
a member never downloads, and a member who opens the address gets the member's
page.

The way back follows history; a page opened from an email has none, and there
the link leads to the Library. A title that does not exist, one the reader may
not open, and a read that failed are three different pages.

`src/client/request-sheet/` is the one place a title is asked for, from any
page:

```tsx
{
  asking && (
    <RequestSheet
      user={user}
      subject={{ kind: "movie", title, target: { externalId } }}
      onClose={() => setAsking(false)}
    />
  );
}
```

The sheet is open for as long as it is rendered. `subject.target` is a library
item or a catalog identity; a catalog title joins the library when the request
is sent. It asks who the request is for (owner only), which version of a film or
which seasons of a series, how long to keep it (owner only; a member's request
is always just for now), and the subtitle languages, chosen from a list instead
of typed as codes. `form.ts` maps those answers to commands and `submit.ts`
sends them through `writeApi`, so every request carries the session's CSRF token
and a retry key. A request whose outcome is unknown locks the sheet's answers
and is sent again unchanged. Choosing seasons sends one command per season. A
request for the Specials season, whether ticked among the seasons or made from
that season's own page, carries `includeSpecials`: the server leaves season-zero
episodes out of any request without it. If a request for several seasons stops
part-way, the seasons already accepted stay requested, so the sheet says which
they are, locks its answers, and asks for the rest the same way. The
two keeping answers are named from `src/shared/household/names.ts`, as the
Library's switch and the server's message for a request with no answer are.

Two more building blocks come with it: `ui/sheet.tsx`, a native modal
`<dialog>` (focus containment, Escape and focus return are the browser's; a
press on the backdrop also closes it), and `ui/menu.tsx`, a button that
discloses a short list of actions.

In fixture mode every primary action has a film and a series: see the cases in
`e2e/browser/title-actions.spec.ts`. "Blade Runner" has two versions, "The
Expanse" and "Get Out" are leaving soon, "Silo" and "The Holdovers" are removed
but restorable, and `/catalog/movie/155` and `/catalog/series/1398` are titles
the household does not have.

### Calendar

`/calendar` (`src/client/calendar/`) has Month, Week and Agenda views. It
reads the episodes of series the household follows and the United States
cinema, digital and disc dates of its films from `GET /api/v1/calendar`.
The address keeps the date range and filters.

| Parameter | Values                                         | Left out                              |
| --------- | ---------------------------------------------- | ------------------------------------- |
| `month`   | `YYYY-MM`                                      | The viewer's current month.           |
| `view`    | `agenda`, `week`, `month`                      | Agenda up to 760 px wide, then Month. |
| `week`    | `YYYY-MM-DD` within the selected week          | The viewer's current week.            |
| `kind`    | `episode`, `theatrical`, `digital`, `physical` | Every kind.                           |
| `status`  | `available`, `missing`                         | Ready or not.                         |

A fragment `#day-YYYY-MM-DD` marks one day: the date field and a full square's
"more" link write it, and the agenda scrolls to it. Previous, next and Today are
links, so Back undoes a step. Week navigation moves seven calendar days at a
time. The filters, the date field and the keyboard rewrite the current entry.

A release date is a civil date, never a moment in the viewer's time zone.
`calendar/dates.ts` keeps a date as the `YYYY-MM-DD` text the API sends, does
its arithmetic in UTC (which has no clock changes), and formats in UTC; the only
thing it asks the viewer's clock is what today is. `calendar/events.ts` sorts
releases onto days by that text. A release with no date yet (`date: null`) is
listed under "Date not announced" without assigning it to a day.

Agenda reads the month itself, Month reads the whole Sunday-to-Saturday weeks
around it, and Week reads exactly one Sunday-to-Saturday range. Week shows all
seven days in a grid on wide screens and as a list on narrow screens.
`useCursorList` with `paging: "all"` loads each range in full.

The Month and Week grids have one Tab stop (`calendar/month-grid.tsx`).
Left and Right move a day. In Month, Up and Down move a week. Home and End go
to the ends of the week, and Page Up and Page Down move by the selected period.
Focus follows the selected day across periods. Tab from a day visits its
releases and then leaves the grid. A square lists up to three releases, or
two and a link to the rest in the agenda. Below 640 px of its own width a
square shows the release count as a link to the agenda.

### History

`/history` (`src/client/history/`) shows what is playing now and what has been
watched. An owner reads the household's plays and can narrow them to one
person; a member reads only their own, which the playback API decides and the
page does not.

| Part        | Read                               | Notes                                                                            |
| ----------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| Now playing | `GET /api/v1/playback/now-playing` | Asked again every minute. A stale answer says so instead of listing old streams. |
| Statistics  | `GET /api/v1/playback/statistics`  | Three totals, then ranked bars. Hidden when there are no plays to count.         |
| Plays       | `GET /api/v1/playback/history`     | Newest first, 25 at a time through `useCursorList`.                              |

The title search, the person and the two days are query parameters (`search`,
`userId`, `from`, `to`) that narrow the statistics and the list together.
`from` and `to` are moments, the midnight that starts a day where the reader
is: a play happened at a moment, unlike a release date.

A play, or a stream, links to its title page when its `media` is present and is
named without a link when it is null.

A ranked bar is a `<progress>` whose `value` and `max` are the row's plays and
the busiest row's, styled in `history.module.css`. Its length therefore comes
from an attribute and never from an inline `style`, which the
Content-Security-Policy refuses. Each bar is hidden from assistive technology,
because its row already says the same numbers in words. `history/format.ts`
holds how those numbers are said.

### Notifications

`/notifications` (`src/client/notifications/`) lists what Media has told the
reader, newest first. `GET /api/v1/notifications` returns one row per delivery
channel; the page shows one entry per event by grouping the rows on `event.id`
and nothing else (`notifications/model.ts`), with each channel as a badge that
says how its delivery ended up. The read returns at most 100 deliveries and
does not say whether more exist, so the page says "Earlier notifications are
not listed" only when an answer is exactly that full.

An entry names the title its event is about and shows its poster when
`event.media` is present, and links to `/media/:id`; a season or an episode is
named with its series (`rootTitle`). With no `media` it is a plain sentence
that links nowhere. An event that batches several titles
records only the first, so no sentence says how many. The kinds, channels and
delivery states are typed as strings on the wire; the client lists the ones the
server sends in `presentation/notification.ts`, and a value outside those lists
fails the page instead of being shown under a guessed label.

The one read state a notification has is the reminder shown in Media for a
title that is leaving: its `in_app` delivery is `pending` until its reader
marks it as read, which posts `/notifications/:id/read` and starts the title's
seven-day warning. That is what "unread" means on the page and what the bell in
the top bar counts. The bell and the page read through one cached query
(`use-notifications.ts`, asked again every 30 seconds), so they cannot
disagree; a message that only went out by email or Discord is never counted.

What can be done about one delivery is under the entry's "Delivery details",
open already when a delivery bounced, failed, or could not be confirmed: send
it again, ask the provider what became of it, and for the owner give the
provider's receipt. An owner-health alert about an earlier state takes no
commands.

How to be told is its own page, `/notifications/settings`, reached from the
account menu and from the list: the email address and its verification, the
Discord link, and which messages are sent. The server writes two more
addresses, which must keep working: the link in a verification email
(`/notifications/email#verify=<token>`, and `/notifications#verify=<token>`
from older emails) and Discord's return (`/notifications/discord?code=&state=`).
Each shows what it is about to confirm and sends nothing until the reader
confirms, so a mail scanner that opens the link changes nothing.

### Client styles and themes

The client is styled with CSS in five cascade layers, lowest priority first:
`reset`, `tokens`, `base`, `components`, `pages`. Most of it is global; the
shell, the Manage pages, and the form primitives in `ui/` use CSS Modules
(`*.module.css`, read through `ui/class-names.ts`), whose rules sit in
`components` like the shared classes. A CSS Module scopes container names as
it does class names, so `@container <name>` only matches a container declared
in the same file; a module that sizes itself against a container declared
elsewhere uses an unnamed `@container (…)`.

| File                                                     | Layer           | Holds                                                     |
| -------------------------------------------------------- | --------------- | --------------------------------------------------------- |
| `src/client/styles/tokens.css`                           | `tokens`        | Every color, type size, radius, shadow, and spacing step. |
| `src/client/styles/fonts.css`                            | none            | The `@font-face` rules for the self-hosted fonts.         |
| `src/client/styles/base.css`                             | `reset`, `base` | Element defaults.                                         |
| `src/client/styles.css`                                  | `components`    | The layer order, shell sizes, and the shared class rules. |
| A feature's own stylesheet, such as `calendar/style.css` | `pages`         | Rules for one page or panel.                              |

A rule in a later layer wins over an earlier one whatever its specificity, so a
page rule never needs a longer selector to override a component. The browser
fixes the layer order at the first `@layer` it reads, which is why `main.tsx`
imports `styles.css` before the application.

No stylesheet other than `tokens.css` holds a hex color. Semantic tokens such as
`--surface` and `--text-muted` choose between raw palette values with
`light-dark()`. That function is Baseline Newly available, so it never reaches a
browser: Lightning CSS, which `vite.config.ts` selects as the CSS transformer,
rewrites it for Vite's Baseline Widely available target into custom properties
that follow `color-scheme`. The browser suite fails if the built stylesheet
still contains `light-dark()`.

The theme follows the system color scheme. Setting `data-theme="light"` or
`data-theme="dark"` on the root element pins one; that attribute is the only
supported switch, because the rewritten tokens follow the `color-scheme`
declarations in `tokens.css` and not a `color-scheme` set from script. The
`theme-color` metas in `index.html` repeat the two canvas colors.

The account panel offers System, Light, and Dark. `shell/theme.ts` keeps the
choice in `localStorage` under `media.theme` (nothing is stored for System),
applies it from `main.tsx` before the first render, and points both
`theme-color` metas at the pinned canvas. The page has no inline script, so a
pinned theme is applied by the module script; if storage is unavailable the
choice lasts until the page is closed.

Status badges take one of five tones (`ok`, `progress`, `warn`, `danger`,
`neutral`) from the table in `src/client/status/tone.ts`. `Status` accepts only
the values in that table, so a contract enum that gains a value fails
`typecheck` at the badge that shows it until the value has a tone. `WireStatus`
is for the fields the API contract types as plain strings, where a word outside
the table reads as neutral.

DM Sans and Manrope are bundled from `@fontsource-variable` and served from
`/assets`; the client requests nothing from another origin.

### Installable web app

Media can be installed from the browser: added to a phone's home screen or
installed as a desktop app, it opens in its own window at `/` with no browser
toolbar. `public/manifest.webmanifest` declares that, and `index.html` links it
with the icons. A browser that does not read manifests shows the same site in a
tab.

| File in `public/icons/`                        | Used for                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `favicon.svg`, `favicon-32.png`                | The tab icon. The PNG is for a browser that takes no SVG favicon. |
| `icon.svg`, `icon-192.png`, `icon-512.png`     | The app icon the manifest names, shown as drawn.                  |
| `icon-maskable.svg`, `icon-maskable-512.png`   | The app icon for a launcher that cuts its own shape.              |
| `apple-touch-icon.svg`, `apple-touch-icon.png` | The iOS home screen, 180 pixels.                                  |

The mark is the `m.` of the shell's wordmark: two arches in Mist and the amber
Lamp dot on a Spruce tile. Each SVG is written by hand and holds that mark for
one place. The favicon is redrawn on the 32-pixel grid of a tab. The maskable
icon runs Spruce to every edge and keeps the mark inside the centered circle,
radius 40% of the icon, that every launcher mask leaves. The iOS icon also runs
to the edge, because iOS rounds the corners itself and paints transparency
black.

The PNGs are committed; no build step draws them. After changing an SVG, draw
them again with the Chromium the browser suite uses, look at the result, and
commit it:

```sh
cd packages/media && bun scripts/render-icons.ts
```

The manifest's `background_color` and `theme_color` are both the dark canvas,
`--spruce-900`. A manifest holds one color for every device, and that color is
on screen before any page is: the launch screen, around the icon, which is
itself Spruce. Once a page has loaded, its `theme-color` metas take over and
follow the theme, pinned or not (see
[Client styles and themes](#client-styles-and-themes)).

The manifest and the icons keep fixed addresses, `/manifest.webmanifest` and
`/icons/*`, instead of hashed names under `/assets`. An installed app, a home
screen and a bookmark hold those addresses for years, the manifest's own
address should not move, and Vite rewrites no URL inside a manifest, so hashed
icons would need a build step that writes the manifest. Vite copies `public/`
into `dist/` unchanged, and `mountMediaClient`
(`src/server/static/client.ts`) serves exactly those two paths from it with
`Cache-Control: no-cache` and an entity tag: a browser asks before each use and
an unchanged file costs an empty `304`, so a new icon is seen at the next
check. They are never `immutable`. A path under them with no file is a `404`,
never the application shell.

Neither path is behind the session. A browser fetches a manifest without
cookies, and the sign-in page shows the same icons. Anything put in front of
Media that requires sign-in has to let both through.

There is no service worker, so no offline mode and no web push: installed
Media needs the network exactly as a tab does. There is no install button
either; the browser's own menu installs it.

### Security headers

Every response (the application shell, its assets, and the API) carries the
headers from `src/server/static/security-headers.ts`, the application's first
middleware: Hono's `secureHeaders` defaults, `X-Frame-Options: DENY`, and this
Content-Security-Policy.

```text
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'
```

| Directive                                         | What the client does that needs it                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| `default-src 'none'`                              | Nothing; whatever is not listed below is refused (frames, media, workers).     |
| `script-src 'self'`                               | The module script and its chunks under `/assets`. No inline script, no `eval`. |
| `style-src 'self'`                                | The one stylesheet. No `<style>` element and no `style` attribute.             |
| `img-src 'self'`, `font-src 'self'`               | The bundled fonts, artwork, and the icons. No `data:` or `blob:` URL.          |
| `connect-src 'self'`                              | `fetch` to `/api`, uploads included.                                           |
| `manifest-src 'self'`                             | `/manifest.webmanifest` (see [Installable web app](#installable-web-app)).     |
| `form-action 'self'`                              | Forms submit through script; left alone, they would post to Media.             |
| `base-uri 'none'`, `object-src 'none'`            | Nothing; no `<base>` and no plugin content.                                    |
| `frame-ancestors 'none'`, `X-Frame-Options: DENY` | Nothing frames Media, the Hub included.                                        |

The policy names no origin but Media's own, and that is the rule for changing
it: a new origin, or a new kind of resource (an inline script, a `data:` image,
a frame, a worker), needs its directive changed in that module, with the reason
in the same change. Loosen one directive for one need; never add
`'unsafe-inline'` or `'unsafe-eval'` to make a library work. Leaving for another
site is not restricted: the Plex sign-in link and the Discord authorization
redirect are navigations.

Two parts of the build exist for the policy. `build.assetsInlineLimit` is `0`,
so a small asset is a file under `/assets` and never a `data:` URL. And
`src/client/startup/zod.ts` sets zod's `jitless` option, because zod otherwise
tries `new Function` once to see whether it may compile parsers, which a
browser reports as a violation; `vite.config.ts` keeps that module in zod's own
chunk so it runs before a schema is built in any other.

The policy is enforced wherever the built client is served: by the server, and
by the browser suite, whose harness (`e2e/browser/server.ts`) puts the same
middleware and the same client mount in front of `dist/`. Every browser test
fails on a
`securitypolicyviolation` event or a console error about the policy, and
`e2e/browser/policy.spec.ts` covers the sign-in page and the two hand-offs to
another site. The Vite dev server (`bun run dev:fixture`) sends no policy,
because hot reload needs inline and evaluated script, so a violation shows in
`bun run test:e2e` and not in development.

Anything in front of Media that rewrites pages to add script is refused by the
same policy. Behind Cloudflare that means Rocket Loader, email address
obfuscation, and Web Analytics injection stay off for this host.

### Client forms

The owner's Manage pages are built from the primitives in `src/client/ui`.
Pages outside Manage still use the shared classes in `styles.css`.

| Module                        | Provides                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ui/forms/form.tsx`           | `Form`, `FormFooter`, `FieldRow`, `useSavedNotes`                                                                                                |
| `ui/forms/field.tsx`          | `TextField`, `SelectField`, `TextAreaField`, `CheckboxField`, `ChoiceField` (radios, with `required` and an error), `FieldGroup`, `InlineSelect` |
| `ui/forms/duration-field.tsx` | `DurationField`: a length of time as an amount and a unit                                                                                        |
| `ui/forms/list-editor.tsx`    | `ListEditor`: a list of distinct values, reordered with move buttons                                                                             |
| `ui/button.tsx`               | `Button` (`primary`, `secondary`, `quiet`, `danger`), `IconButton`, `ButtonLink`, `ButtonRow`                                                    |
| `ui/confirm-dialog.tsx`       | `ConfirmDialog`, a native modal `<dialog>` whose Cancel takes focus                                                                              |
| `ui/panel.tsx`                | `Panel`, `Disclosure`, `DisclosureList`, `SkeletonRows`, `EmptyNote`                                                                             |
| `ui/data-list.tsx`            | `DataList` and `DataRow`: rows that stack into cards in a narrow container                                                                       |
| `ui/feedback.tsx`             | `Callout`, `LoadError`, `Badge`                                                                                                                  |

`Form` owns validation. On submit it reads each control's own constraints
(`required`, `min`, `pattern`, and so on, worded by `ui/forms/validation.ts`) and the
form's `validate` function, shows each problem beside its field and in a
summary, and moves focus to the first one; `onSubmit` runs only when there is
nothing wrong. A field is also checked when focus leaves it after an edit, and
its error clears once the value is acceptable. A field reports through `Form`
by its `name`, or by `data-field` for a control that is not an input.

A length of time is a `DurationField`: a number and a choice of unit, read
back with `readDuration` from `ui/forms/duration.ts`. The contract's unit stays
seconds and the conversion is exact both ways. A stored value is shown in the
largest offered unit that states it as a whole number, and what is typed is
multiplied out in decimal, so an amount that is not a whole number of seconds
is refused with a field error instead of being rounded. Each field's units and
limits are one `DurationRules` object shared by the control and the form's
reader, such as `DURATION_RULES` in `manage/providers/provider-input.ts`.

A form says where it stands in `FormFooter`: "Unsaved changes" from the first
edit, then a message naming what was saved, which stays until the next edit.
A saved row is usually refetched and remounted with its new version, so the
list above it keeps that message with `useSavedNotes`.

A form that reads its controls by name (`FormData`) keeps the reader in its own
module, such as `manage/providers/provider-input.ts`, so the request body does
not depend on the layout. The quality profile form keeps typed state instead:
`manage/quality/profile-model.ts` turns stored rules into form state and back.
Reading a stored profile and building it again must give the same rules, with
nothing rounded, reordered, or dropped; `profile-model.test.ts` and
`testing/fixture-api/profile-form.test.ts` hold that. Rules the schema rejects,
such as a value outside an enum, are shown as an error in place of the form.
A profile captured from Radarr or Sonarr (`rules.resolved`) is the one part
edited as JSON, because it is a hashed snapshot holding the source
application's own custom-format data.

### Native subtitle tools

Native caption and Workflow checks require real `media-subtitle-analysis` and
`ffsubsync` commands. `runMediaTool` uses the credential-free fixed search path
`/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin`; activating a shell virtualenv
does not expose its tools to the worker. Missing tools fail these checks rather
than skipping speech measurement or timing alignment.

From the repository root, reproduce the Temporal Dockerfile's isolated,
hash-locked environment with the matching analysis script:

```sh
subtitle_tools="$HOME/.cache/media-subtitle-tools-0.5.1"
uv venv --python 3.13 "$subtitle_tools"
uv pip install --python "$subtitle_tools/bin/python" --require-hashes --only-binary :all: -r packages/media/scripts/subtitle-build-requirements.txt
uv pip install --python "$subtitle_tools/bin/python" --require-hashes --no-build-isolation -r packages/media/scripts/subtitle-requirements.txt
cp packages/media/scripts/subtitle-analysis.py "$subtitle_tools/analysis.py"
"$subtitle_tools/bin/python" -c 'from importlib.metadata import version; assert version("ffsubsync") == "0.5.1"'
printf '%s\n' '#!/bin/sh' "exec \"$subtitle_tools/bin/python\" \"$subtitle_tools/analysis.py\" \"\$@\"" > "$subtitle_tools/media-subtitle-analysis"
chmod +x "$subtitle_tools/media-subtitle-analysis"
```

Inspect existing command entries before installation. In a writable directory
already in the fixed search path, expose the two entrypoints without replacing
unrelated tools; for example, on a Homebrew Apple Silicon host:

```sh
ln -s "$subtitle_tools/bin/ffsubsync" /opt/homebrew/bin/ffsubsync
ln -s "$subtitle_tools/media-subtitle-analysis" /opt/homebrew/bin/media-subtitle-analysis
```

Keep both lock files and `subtitle-analysis.py` from the same checkout used for
verification. The wrapper retains absolute interpreter/script paths; no worker
search-path change or system Python package installation is needed.

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
acceptance. The operator-run native PMS lane (see
`packages/woodpecker-config-extension/reproduction/pms-runner`) and household
acceptance remain required; CI cannot run it because movie editions need a
licensed Plex server.

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

## Selected living-room quality profiles

Owner administration provides a preview and explicit apply action for the
selected movie or TV TRaSH profile. The preset targets a Samsung QN90B, Apple TV
4K with Infuse, and Sonos Arc: HDR10/HDR10+ preference, a mild DD+ Atmos score
of 300 and DD+ score of 50, and neutral lossless audio. The movie ladder ends at
2160p remux; TV ends at the equal-rank 2160p WEB group. Both use the intended
10,000-score upgrade cutoff, duration-based guide sizes, and explicit 4K size
overrides. Equal WEB sources stay equal rather than becoming accidental upgrade
steps. Duplicate format assignments are normalized to one selected ID and one
explicit household score; the unused TV remux size override is omitted.

The compiler in `src/domain/quality-guide/` reuses the resolved source evaluator
and its packaged .NET regex evidence. It retains original audio: English for
English originals, otherwise the canonical original language. An unknown listing
audio language permits a provisional download only. Measured inspection requires
the original audio and compatible video signaling before publication. Dolby
Vision without a standard compatible base layer is rejected; unknown Dolby
signaling remains protected. Foreign originals also require regular English
captions, derived from the actual title's assigned immutable profile, independently
of requester language choices.

The `media-quality-guide` Temporal schedule runs daily. Its Network activity
fetches only the selected fixed source paths at one immutable TRaSH Git revision,
validates every definition, and appends a new `QualityProfileVersion` only when
the selected content changes. Explicit score overrides survive refresh. An
invalid response preserves the last good version and records a sanitized failure
visible in owner administration. Active reservations defer pointer changes until
their captured profile drains; updates do not rewrite files or increment target
generations. Existing playable files with unproven measured evidence remain
protected from automatic replacement. Applying a new default changes future
requests; assigning an existing title still uses its explicit profile control.

The owner API is `GET /api/v1/admin/quality-guide`, `POST
/api/v1/admin/quality-guide/preview`, and `POST
/api/v1/admin/quality-guide/apply`. Apply requires the reviewed source revision,
content hash, expected profile version, and idempotency key. Managed profiles
use these controls instead of the raw profile editor so source provenance and
overrides cannot be silently removed. The bundled public guide test snapshot is
MIT licensed; its revision is evidence for tests, never a production fallback.

## Recurring personal subtitle maintenance

The declarative `media-subtitle-wanted-v1` and `media-subtitle-upgrade-v1`
Temporal schedules inspect bounded pages of owned, published video versions.
Each planner hands targets to independent, 24-hour-bounded job Workflows and
awaits only their durable start. A pending target cannot block later assets;
jobs survive planner completion, page continuation and cancellation. Repeated
plans retain the same operation identity and do not restart existing, failed
or cancelled jobs. Native replacement coordinators still own swap and recovery.
Wanted searches run every six hours; after three weeks from the first failed
search, that target retries weekly. Upgrades run every twelve hours for captions
created in the past seven days, including manual origins with genuine accepted
matching evidence. The typed `subtitleMaintenanceEnabled` behavior defaults on.
Current request, imported-policy, assigned household-profile, ownership, epoch,
and exact movie-edition authority are rechecked before any Files effect.

Source scores retain the audited Bazarr 1.6.2 match weights and actual observed
matches, bound to a canonical catalog and measured-video reference hash. TV
requires 70 percent and movies 80 percent; improvements must exceed the current
accepted score under the same reference. Provider canonical IDs can establish
foreign-title identity. Missing metadata earns no points, conflicting IDs reject,
and unknown historical scores protect the installed caption. Rejected digests
and actual download candidate IDs exclude only definitive failures under that
same reference. Unknown download outcomes keep their existing journal and never
authorize a blind retry or another provider download within that operation.

The observed English Subf2m fallback uses a bounded native fixed-origin adapter
alongside OpenSubtitles, ASSRT, SubHD and Zimuku. Unknown forced/HI flags remain
unknown. Files independently measures regular dialogue and applies the audited
TV 96/movie 86 synchronization thresholds before installation or before an
immutable replacement snapshot. Provider identity and source authorship remain
separate from this timing proof.

Movie speech preparation checks the stored V4 operation and its exact edition,
current consent and access before and after measurement, retaining the original
Activity capability and 100-record read budget. A measured candidate advances
from version zero to one before installation. Installation receipts accept only
the existing unmeasured zero-to-one transition or a prepared one-to-two
transition with current video/caption checksums, speech and timing proof.

Automatic improvements use the existing replacement preparation, physical
review, swap, compensation and receipt coordinators. Distinct immutable
automatic-candidate and policy-authorization events bind the real download,
numeric improvement, owner, target and physical observation. Human `approvedBy`
and `approvedAt` fields remain unset. PostgreSQL validates automatic ancestry
and same-transaction caption transitions; uncertain physical outcomes remain
reconciling under the existing coordinator.

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

Anyone but a current, unrestricted owner reads a member projection
(`infrastructure/visibility/member-detail.ts`) of that response. A member keeps
each related download's state, progress and freshness, and loses how the title
was acquired: the acquisition attempts, each download's ratio, seeded time and
observation time, the assigned quality profile, the subtitle policies and the
owner's keeping switch. Every withheld field takes a value its contract already
allowed (an empty list or `null`), so the response keeps its shape.
`GET /api/v1/media/:id/releases` applies the same line: it authorizes a
requester as before and then returns release candidates only to an owner, and
an empty list to anyone else.

The response also says how long the household keeps the title, so a title page
can offer what the Library offers:

| Field            | Meaning                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `policy`         | `keep`, `temporary` or `unclassified`, derived as the root title's item on `GET /api/v1/library` is.                                   |
| `libraryKeeping` | `{ mediaVersion, targetVersion, keepingPolicy }` for the root title's default edition, for a current, unrestricted owner; else `null`. |

Both describe the root title: a season or episode reports its series', and the
versions are the series'. `libraryKeeping` is what
`POST /api/v1/library/:id/keeping-policy` expects, sent with `rootMediaId` as
the title. The list and this read share one derivation
(`infrastructure/library/views/policy.ts`), so a title the list shows reports
the same values in both.

This read follows the title's default target, not the list. A title held by its
library Keep alone leaves the list when the owner turns that Keep off, and its
detail still reports `libraryKeeping`, now `temporary`, so the owner can turn it
back on from the title page. Its `policy` is `unclassified`, as it is for any
title that is neither kept nor followed. `libraryKeeping` is `null` only for a
title with no default target, which the command could not change, and for
anyone but the owner. A title in a Plex library the reader may not open reports
`unclassified` and `null`.

Each entry of `requests` carries `interestRevision`, `interestState` and
`keepingPolicy`, named as `GET /api/v1/request-interests` names them, beside the
request's `version`. The version and the revision are what
`POST /api/v1/request-interests/:id/commands` expects, so a title page can stop
following without a second read. `keepingPolicy` is the request's own (`keep` or
`temporary`): while it is `keep`, that command refuses `drop` and `finished`
with 409 `keep_protected`. All three are `null` for a request with no interest
of its own: a row that a series or season request spread onto an episode, whose
interest is managed on that original request. A member still reads only their
own requests.

`runtimeMinutes` is the row's own runtime in whole minutes: a film's, or an
episode's. A series and a season store none, so theirs is `null`; nothing is
summed or averaged from their episodes. It is also `null` when TMDB does not
know the runtime, which TMDB reports as 0.

`followers` tells the household who follows the root title, so a member can see
more than their own request:

| Value                   | Meaning                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `[{ displayName, me }]` | One entry per person who follows the title. `me` marks the reader's own entry. |
| `[]`                    | Nobody follows it.                                                             |
| `null`                  | The names are withheld from this reader. Do not read it as "nobody".           |

- A follower has an active, not excluded claim on the root title itself whose
  interest is `following`, on any edition. These are the claims behind the
  library's `temporary` policy and `myInterest: following`, so `followers` is
  empty exactly when the household does not follow the title.
- A season or episode reports its series' followers. A claim on only a season or
  an episode does not make its owner a follower of the series, and a series
  request's rows on its episodes are still one follower.
- The name is the display name of the person the claim belongs to, not of
  whoever made the request. A managed profile is named as itself; an owner who
  asked on someone's behalf is not named unless they follow the title too.
- Entries carry a name and `me` only: no user, request or profile identifier.
  The reader comes first, then the others by name.
- `null` goes to an account the owner restricted, and to anyone for a title in a
  Plex library they may not open. Everyone else in the household, the owner
  included, reads the same names; the owner's `requests` is unchanged.

`GET /api/v4/media/:id/movie-editions/:edition` applies that projection to its
`progress`: a requester of the edition keeps each download's state, progress and
freshness, with no attempts, ratio, seeded time or observation time. Quality
profiles are owner configuration: `GET /api/v1/profiles` returns the list to a
current owner and an empty list to anyone else, and
`GET /api/v1/profile-defaults` refuses anyone who is not a current owner.

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

Inventory reconciliation queues ordinary default-only cold verification for
already owned assets. Owned movies with a current schema2 association use their
explicit immutable movie physical parent to renew either the default or a named
cut through the same reverification workflow. Renewal changes the scoped binding
and invalidates only that cut's derived watch and retention projections. It
neither creates requests nor refreshes consent or old publication receipts.
The `@shepherdjerred/media/plex-binding` export defines
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

Scoped movie publication captures full authority separately in both transactions
and revalidates its exact file plan after locking the physical rows. Torrent
observations and the edition definition are locked too. Filesystem callbacks
retain that transaction's authority and original deadlines while checking current
configuration and acquisition gates, avoiding repeated reads of immutable parents.

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

## External library registration API

Existing Plex libraries can be registered separately through the owner-only
external-library API while Radarr and Sonarr continue running. First adopt each
canonical movie or series through `catalog.adopt` and finish its catalog refresh.
`GET /api/v1/admin/external-library/items?sectionType=movie&offset=0` (or `show`)
lists bounded Plex items and their actual GUIDs and Parts. `POST
/api/v1/admin/external-library/preview` takes `{sectionType,ratingKey}` and an
`Idempotency-Key`; inspect the returned canonical mapping, physical cohort and
protected conflicts. `POST /api/v1/admin/external-library/apply` takes
`{previewOperationId,previewHash}` and its own stable `Idempotency-Key` within the
60-second review lifetime. It rechecks the current owner, PMS server/section,
GUID hierarchy, exact Part/path/size, canonical versions and complete normal
inventory cohort before recording the explicit command and registration event.
Each episode must expose its exact canonical TMDB episode GUID; matching season
and episode numbers or IMDb/TVDB GUIDs alone do not prove that identity. The same
check gates availability from historical registrations against the current
canonical episode and inventory, without rewriting their stored records.
Missing catalog identities, stale reviews and changed proofs require a new
preview. Owned paths, any owned coverage history and active reservations are
preserved and reported rather than overwritten.

Registration creates only passive default targets when missing, unowned
published assets and their current coverage. It creates no request, monitoring,
profile binding, torrent, filesystem ownership or automation grant, and leaves
existing targets unchanged. Movie and episode reads project generic available
presence only while the registered inventory evidence is fresh; registration
does not change their stored lifecycle, target availability or collection state.
Generic externally managed Plex availability is
separate from owned playable bindings. Movie labels are retained as observed;
an unmarked or unverified cut never implies Theatrical or fulfills a canonical
edition request. Availability requires the latest normal inventory source
collection (phase `section >= 2`, independently of later owned cleanup) within
25 hours: the 24-hour cadence plus its one-hour execution bound. Current
unowned coverage continues protecting against duplicate acquisition and
upgrades when that observation becomes stale. Inventory itself remains
observation-only; registration requires the explicit owner command.
During an incomplete or failed inventory collection, replaced cohort evidence
temporarily shows reconciliation until a complete collection is available.

Edition correction is a separate owner-reviewed metadata-only command
(`edition-preview`, `edition-apply`). It verifies the configured server/section,
canonical GUID and filename cut, single Part/path/size and watch facts, then
records durable intent before changing only `editionTitle`. It grants no
filesystem ownership or automation authority and leaves exclusive v3 handoff
unchanged. Unmarked files never imply Theatrical; ambiguous markers remain
protected. An uncertain intent permits readback only, never another PUT.

## Ownership handoff API contract

The owner-only handoff API accepts stored immutable migration bundle reviews.
Normal session authentication, CSRF protection, and an `Idempotency-Key` apply to
commands. The application never accepts caller assertions of stopped managers,
verified files, or trusted mount identities.

| Endpoint                                                   | Contract                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/admin/handoffs`                              | Exact bundle/review hashes and versions, runtime epoch/version, explicit provenance selection, and immutable imported profile bindings. Initial library adoption uses per-file movie classifications; schema version 3 adds explicitly approved Plex label correction. Returns an operation and handoff ID. |
| `GET /api/v1/admin/handoffs/:id`                           | Current preparation state, exact selected scope, complete proof plan/hash, expiry, and eventual receipt ID.                                                                                                                                                                                                 |
| `GET /api/v1/admin/handoffs/subtitle-policies?mediaId=:id` | Owner-only, bounded lookup of each target's own default-edition policy version, or `-1` when absent. Inherited effective policies do not substitute for a local version.                                                                                                                                    |
| `POST /api/v1/admin/handoffs/:id/apply`                    | Exact prepared plan hash/version and runtime epoch/version, with the matching protocol. `ApplyLibraryHandoffV2Schema` acknowledges household holds; historical `ApplyHandoffSchema` also acknowledges protected legacy sources. Queues fresh proof and an apply operation.                                  |

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

Handoff Files workers resolve the approved canonical paths through the existing
worker path mapping for hashing, probes, sidecar discovery and native file locks.
The approved paths, reports and hashes remain canonical; file identities describe
the actual local files. Each mapped path must round-trip to its approved library
root before use. Workers without a mapping retain direct path access.

The owner screen builds this library-only report from selected captures and
explicit source/Media root paths. After approving the canonical mappings, select
up to 25 existing files, choose the matching imported quality profiles, and
resolve any ambiguous movie cuts. Captions and policies are associated by exact
manager instance, source ancestry and video path. Generic Chinese remains
unresolved unless the owner selects Simplified Chinese. The separately prepared
review shows the classified files and exact before/after Plex edition labels;
its URL retains the handoff ID for reloads. Adoption requires that plan's explicit
approval and current proof, rather than report approval alone.

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
Shared TV/anime files retain every exact episode association. Plex can assign
distinct Part IDs to those episode items despite their identical physical path;
each item retains its own Part identity. Serving verification still requires
complete coverage, the exact path and size, and the canonical show/season/episode
hierarchy in both stable passes.

The adoption transaction queues one `verify_library_plex_binding` command for
each physical file. Its separate Network Workflow receives only operation,
receipt, asset and epoch IDs. It resolves the original approved receipt and
literal source report, then verifies the current Plex cut or complete TV
hierarchy in two stable passes before installing serving bindings. Catalog
refreshes may add identifiers; changing an original title identifier or episode
coordinate requires reconciliation. The receipt preserves its original SDK,
writer and 60-second verification bounds. Historical acknowledgements use the
immutable source and association rows independently of current ownership or
configuration. Adoption creates no personal requests or acquisition attempts,
and the serving check does not edit Plex watch history.
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

For an adopted movie, the actual applied library approval can authorize monitored
quality upgrades independently of personal requests. The coordinator reads the
original receipt and plan, current owner role, monitored target, profile version,
recovery epoch and exact Plex binding. Discovery and every later effect retain
the invocation's original SDK deadline and shared provenance allowance. A new
management acquisition uses identity version 3 and file-plan version 3 with a
null request sponsor; its immutable birth identifies the real import approval.
Personal acquisitions retain their existing formats and consent checks. Neither
path creates historical acquisitions or authority over existing torrents.

Imported quality evidence retains its measured bytes, audio, quality and unknown
revision. Current catalog duration and original language are read-only inputs
to the current comparison. A higher quality below cutoff can improve an imported
file with unknown revision; same-quality revision upgrades require known evidence.
Movie scene parsing removes assessed cut spans only for quality recognition and
keeps those tokens in the simplified title used by custom-format rules. The
original release, filename and cut evidence remain unchanged.

The recurring reconciliation sweep queues adopted movie scopes through the
registered movie coordinator. Revoked monitoring, permission, profile or target
generation stops an unsubmitted acquisition and releases its reservation. An
uncertain add retains the reservation until observation records its actual
outcome and independent seeding responsibility. A prepared publication retains
its reservation for recovery. New Plex completion receipts use version 3 for
management acquisitions; original receipts and physical publication records
retain their literal formats.

For TV/anime, selected monitored episodes can use their actual applied library
approval for upgrades without personal requests. Shared-file and pack acquisitions
require approval and current policy for every covered episode, one canonical
series, and the configured Plex show section. An episode selection grants no
permission to acquire episodes outside that selection. The management birth
retains the original approval, owner, profile, epoch, exact episode generations,
and immutable Plex association. It uses acquisition identity version 4; existing
file-plan and physical publication formats remain literal. Plex completion uses
receipt version 2 under `managedEpisodePlexReceiptV2`, separately from the original
request-sponsored receipt marker. Completed retries acknowledge that immutable
receipt before evaluating current policy and cannot project downloading again.
The Network and Files adapters capture their SDK capabilities before loading
the runtime; each Activity shares one provenance allowance across its phases.
Download reconciliation chooses the handler from the literal retained identity,
including legacy attempts, and shares the sweep's original execution and allowance.
Recording a proven transfer's independent seeding responsibility commits before
current library-policy projection, so revoked permission or an exhausted allowance
cannot discard that responsibility.

An owner can additionally select **Monitor this series, including future episodes**
when preparing a TV import, with a separate choice for specials. The v3 request
then contains an explicit version-1 `seriesMonitoring` selection bound to the
captured series record. Earlier approvals without that selection grant no future
episode policy. The original import receipt and verified Plex show association
remain the source; no personal request or historical transfer is created.

After catalog refresh, coverage expansion follows the requester pages with
household pages of at most 25 episodes. It rechecks current owner, profile,
runtime and series policy under the canonical and target locks. New episodes
inherit the approved profile; existing episode overrides remain in effect.
Series acquisitions use management proof version 2 within acquisition identity
version 4, retaining the same file and completion formats. Exact episode-only
approvals retain management proof version 1.

An explicit series approval can cover a complete pack whose episodes were adopted
in later batches. Existing-episode approvals can also combine across batches:
management proof version 3 retains each actual approval and its exact targets,
owner and Plex association, within the same acquisition identity version 4 and
completion formats. This combination grants no future-episode permission.
Every constituent uses the invocation's original deadline and shared provenance
allowance. PostgreSQL checks its actual approval and current policy at creation;
the acquisition's episode coverage, generations and original proof are immutable.
Each member must replace one complete existing physical group,
preserving that group's path and exact episode coverage. A member that would merge
separately owned groups stays protected with `upgrade_coverage_conflict`; the
existing files and ownership remain intact. Revoking a covered episode protects
the whole pack.

`MediaIntent.libraryMonitoring` keeps household monitoring independent from
personal request consent. Creating or cancelling a request preserves an unchanged
household acquisition generation; requester and choice guards still protect its
personal effects. Cancelling an unexpanded request does not manufacture negative
episode targets. Owner removal clears household monitoring. Historical intent
receipts omit this new storage field and retain their literal hashes.

Each batch covers at most 25 physical files and 100 canonical media items.
`activation: "activate"` changes the reviewed observe runtime to active at its
existing recovery epoch. Later `activation: "extend"` batches require current
active authority and a newly reviewed exact runtime version. Explicit selected
episodes may use an approved canonical series scope; unrelated or ambiguous
items remain unowned. No previous acquisition or notification birth epoch is
rewritten.

Adopted-library effects also require a fresh trusted legacy-writer lease and
current per-record epochs. Minute reconciliation refreshes the lease and observed
worker storage bindings. Resumed writers revoke adopted-library authority when
observed. Changed PVC/subpath identities and expired evidence protect effects.
A replacement files Pod on the same verified storage requires a fresh binding.

### Running alongside the existing stack

Media can manage new requests while the existing controllers continue running.
It shares Plex and qBittorrent, uses its own `media` torrent category and
`/downloads/media/<attempt-id>` transfer directories, and keeps existing files
and transfers unowned. Publication retains its per-item ownership and overwrite
checks. Existing-library ownership handoff remains a separate operation.

Maintainerr can remove items directly through Plex, independently of Media's
ownership records. To limit its cleanup to the old stack, add a final AND
condition requiring a positive Radarr movie file size or Sonarr show disk size
to the corresponding cleanup rules. This also protects existing items whose
Plex identities cannot resolve to their old-manager files.

The authenticated owner API exposes `GET /api/v1/admin/runtime` and
`PUT /api/v1/admin/runtime`. PUT requires CSRF, an `Idempotency-Key`, and
`{ "mode": "active" | "observe", "expectedVersion": <current version> }`.
The response contains mode, version, recovery epoch, and ownership confirmation.
Starting requires fresh trusted canonical storage observations from the workers;
it does not require importing a migration bundle or stopping legacy controllers.
Pausing stops Media automation while the existing stack continues operating.
Personal TV Network Activities renew expired Plex access from the requester's
existing encrypted account credential and registered device. Managed Home
requests first revalidate their recorded owner, then use the exact stored profile
token through the existing profile-access resolver. Fresh mappings avoid extra
Plex calls. Renewal keeps the five-minute access check, original Activity deadline
and shared record allowance; denied, restricted or mismatched access cannot
authorize the transfer or publication. It preserves the original acquisition
sponsor and torrent and requires no active browser session.
Owner activation preserves an immutable approval of the exact canonical storage
identity. After a restore, native recovery can use that approval to reprove
Media-created files without requiring a legacy migration bundle. Recovery retains
its existing owner review and quiescence requirements; normal managed automation
uses fresh storage observations after recovery. Legacy adoption keeps its separate
quiescence requirements.

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

Recovery is two pages over one read. The owner's is `/manage/recovery`; `/recovery`
sends the owner there and is a member's own page. A review itself, `/recovery/:id`,
is the same page for both, so a link in a message works for whoever opens it.
The owner's page says first what is waiting (open reviews, held titles), then
lists the household reviews with the applied ones folded away, the held titles
grouped by why they are held with a filter, the owner's identity associations,
the file proofs, the read-only automation authority, and storage capacity. A
review shows its standing (who it waits for, or that it is ready), the titles,
a declaration form for each person the reader may declare for, and, for the
owner, who has declared, what stays as it is, and the apply form: three
statements, then a dialog that names the titles. A review that cannot be
applied, or was, shows no form and says why. Raw identifiers and hashes are
under "Technical details".

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
writes two identical valid synthetic videos, and requests a scan of the reviewed
section without a path restriction so Plex advances its section scan watermark.
It never scans other sections or the hidden control subtree directly.

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

`GET /api/v1/notifications` returns the reader's own deliveries, newest first,
one row per channel. `event.id` is the event a row delivers, so rows that share
it are one notification sent on several channels. `event.media` is the item the
event is about, in the shape a playback session uses
(`shared/household/media-reference.ts`): its own `id`, `kind` and `title`, with
the `rootMediaId`, `rootTitle` and `artwork` of its movie or series. An episode
event therefore names its series, and a movie or series event repeats its own
id and title as its root. A delivery that batches several titles names the
first of its batch. `media` is null when the event
names no item, as owner health, email verification and shared announcements do,
and when the item no longer exists. It is not filtered by the reader's current
Plex library access, because an event that names an item is addressed to people
who asked for that item, whose message names it too, so `GET /api/v1/media/:id`
can still refuse a title a row names. The one event addressed to owners
instead, `system_intervention`, names its title only while its reader is an
owner.

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

Media reuses the existing Streambot Discord application and its
`media-streambot-config` Secret. The owning `streambot-config` password-manager
item supplies `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` only to
[`api.ts`](../homelab/src/cdk8s/src/resources/media/application/api.ts); its
existing `BOT_TOKEN` supplies `DISCORD_BOT_TOKEN` only to the network worker in
[`workers.ts`](../homelab/src/cdk8s/src/resources/media/application/workers.ts).
The files worker and workflow executor receive none. Provision the app's actual
client ID in that same item, preserve its existing credentials, and refresh the
committed vault snapshot before deploying these required references. Preserve
Streambot's existing OAuth redirect when adding Media's canonical origin followed
by `/notifications/discord` to the same application's redirects. Both OAuth
fields must be configured together; partial configuration fails API startup.
Keep Discord flags disabled until provisioning, deployment, and authenticated
delivery verification are complete; optional secret references are prohibited.

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

Scoped movie Retry queues an exact selected-scope command with the current media
and target versions. It retains the original personal choice or library approval,
generation, profile, release and acquisition attempt. The Network coordinator
requires observed terminal runs for both predecessor Workflows before recording
an immutable coordinator renewal and taking over that same attempt. Recovery
rechecks current scope, permission, quality, cut, runtime and torrent ownership
under the original execution deadline and shared provenance allowance. An
uncertain original add is observed and registered before current demand is
checked, preserving independent seeding responsibility after cancellation. Retry
does not add another torrent. Prepared publications require their separate
continuation authority and are protected from this initial retry protocol.
That continuation retains the exact stored plan and any existing publication
intent, including its original attempt snapshot hash. An imported physical
outcome resumes at Plex without repeating Files work or inventing a live torrent
observation. If Plex already committed, recovery finalizes its exact original
input without changing the acquisition coordinator. A new completed Retry finds
that history through the exact current Plex binding, without recreating a
reservation or selecting an arbitrary previous attempt.

Scoped movie acquisition failures queue distinct personal and owner intervention
notices from the actual failed command. Personal delivery retains the original
request choice; owner delivery requires current owner identity and channel
preferences. Both recheck the exact movie edition, target generation, recovery
epoch and Plex permission before sending, without requiring a published asset.
Accepted or uncertain provider attempts reconcile their original source and
recipient before current configuration and never authorize a second send.

Download recovery queries the exact coordinator and acquisition Workflow identities.
Only observed terminal runs permit takeover; missing or active child history holds
ambiguous submissions. Stable recovery keys preserve the existing acquisition and
its external-effect journals. Adopted TV recovery rechecks the original library
approval and current owner, profile, exact episode generations and reservations
under the canonical, target and runtime locks. It retains the sweep's original
execution deadline and shared provenance allowance. Recovery can resume the same
reserved, downloading, staged or physically published acquisition without a
personal request, another transfer, or rewriting its birth and file journal.
Revoked authority cannot queue a takeover; prepared files retain their separate
reconciliation path. Inventory scans record Plex observations in bounded
pages without claiming foreign files. Missing-path diagnostics require both
configured libraries to finish enumeration. Knaben exposes a date-ordered native
recent-page reader; the AvistaZ family exposes empty-query recent pages with
separate AnimeZ parameters. Readers retain the source-row count for pagination,
reject oversized pages and keep private download URLs inside Activities. The
periodic sweep captures encrypted source snapshots, immutable page receipts and
resumable per-provider checkpoints together. Matching runs in bounded pages on
the Network worker, checks current exact-title/cut/quality and acquisition authority,
and queues proposals through the existing acquisition paths. Monitored adopted
movies and individual TV episodes use their actual library-management approval
and current owner permissions, without creating a personal request. Selection
and commit share the invocation's original deadline and provenance allowance;
revoked management authority cannot queue an acquisition. Workflow histories
carry source IDs and cursors rather than private releases. A first pass captures
the current page; later passes page back to the previous retained head. Disabled
automation pauses capture and matching. Provider status distinguishes received,
catching-up, paused and failed feeds. Six-hour due searches remain separate;
TPB and MagnetDownload provide title searches only and report
`unsupported_recent_feed`. Private tracker tokens remain in worker memory,
bound to the current credential. Each invocation retains its own database lease
and pacing; a deferred listing can reuse authentication on its next invocation.

Movie searches deferred by a local provider lease or cooldown retain the same
scoped coordinator and wait durably before checking admission again. Each resumed
Activity rechecks current intent, sponsorship, reservations and authority with its
original bounds. Remote authentication failures and download quotas do not gain
this retry behavior. A completed search with no acceptable release returns to
normal six-hour due searches. Default movie requests with an explicit current
edition choice use the guarded scoped coordinator on that due pass; a blocked
choice cannot fall through to historical unscoped acquisition. Pre-choice legacy
requests retain their existing due route.

MagnetDownload title searches retain their encrypted search results and resolved
hash prefix in a typed `ReconciliationScan` checkpoint for the exact query, kind
and page. After pacing defers a resolution, another leased invocation resumes
the next result instead of repeating the search. Only actually resolved sources
can return as partial candidates; the checkpoint stays incomplete until all
retained results resolve. Every checkpoint write fences the exact unexpired
provider lease. Once complete, a later invocation starts a fresh search under
normal pacing. This preserves progress even when the configured interval exceeds
a lease without extending request, lease or acquisition-authority deadlines.

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

The same adoption and refresh writes store a movie's or series' TMDB poster
path, backdrop path and synopsis with the time they were observed; seasons and
episodes have none. Artwork is presentation, not command state: it is written
in the catalog transaction under the canonical lock but never advances the
media `version` that commands compare against. A kept or followed title is
refreshed every six-hour due sweep. Any other owned title is queued for the same
`refresh_catalog` only until its artwork has been observed once, which is how
existing titles are backfilled; an empty observation counts, so a title TMDB has
no images for is not asked about again. Each 50-row due page queues at most ten
titles for artwork alone, so a first backfill adds at most one refresh for every
five rows a sweep visits. That budget rotates with the six-hour period: the page
is scanned as a ring from a start that advances ten rows each period, so every
waiting title is tried at least once in any five consecutive periods. A title
whose refresh keeps failing, such as one TMDB has removed, stays unobserved and
is retried on its turn, but it cannot keep the titles after it from theirs.

That refresh reaches only a movie or series that has a default target, because
the due pages read only rows that have one. A root without one, such as an
imported film nobody has asked for or a series whose episodes are kept while
the series itself was never declared, is on no page. It is also not refreshed:
`refresh_catalog` rewrites catalog facts, and for a series its seasons,
episodes, catalog state and numbering, none of which may change for a title
nobody has declared anything about. Such a root only has its artwork observed.
Each due sweep, once and before its first page, reads TMDB for at most 25 of
them (`automation/reconciliation/root-artwork.ts`) and writes the poster,
backdrop, synopsis and observation time through the same artwork write, under
the canonical lock. It advances no `version`, creates no row and queues no
operation, so it never enters the outbox. The 25 are a window over the waiting
roots in id order that starts at `period × 25` modulo their number and wraps, so
successive windows lie end to end: while the waiting set is unchanged every
root is tried at least once in any `ceil(count / 25)` consecutive periods, and
a backfill with no failures takes exactly that many. TMDB being unavailable, no
longer having the title, or sending an unreadable body leaves that root waiting
without failing the sweep or raising an intervention; it is tried again on a
later turn and cannot keep the others from theirs. There is no marker for a
title TMDB has removed, so such a root keeps waiting and costs one read on each
of its turns. A sweep that is run again in the same period, or whose first
Activity attempt is retried, takes a fresh window of at most 25 from what is
still waiting.

Both backfills are complete when no movie or series with a `tmdbId` has a null
`artworkObservedAt`, apart from titles TMDB no longer answers for; neither
needs turning off, because an observed title stops matching.

Reads return that artwork as `artwork: { posterPath, backdropPath }`
(`shared/artwork/contract.ts`), always the art of the movie or series a row
belongs to, so a season or episode row shows its series'. Both paths are null
until the title has been observed or when TMDB has no image. Library items,
calendar events, removal history, the request and removal lists and media
detail carry it, with `rootMediaId` where the row did not already name its
root; detail adds the root's `overview` and its TMDB identity as `catalog`, and
catalog search and detail add `backdropPath`. The rows of `GET /api/v1/requests`
and `GET /api/v1/removals` also carry `rootTitle`, that movie's or series' own
title, read from the same ancestry: a season or episode row names its series
without a second read, and a movie or series row repeats its own title.
Removal history names an episode's series as `seriesTitle` instead. Request
interests are a strict contract, so `GET /api/v1/request-interests` adds
`artwork` only for a caller that sends `?include=artwork`: a browser tab on an
earlier client rejects any key it does not know, and never sends the
parameter. Their `title` is the requested row's own, and they carry neither
`rootMediaId` nor `rootTitle`.

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

`bun run generate` builds the production Prisma client and a test-only pre038
intent client. Migration-ceiling fixtures use the latter against their actual
historical DDL, including real SQL triggers and interactive transactions. It
does not select or insert the later `libraryMonitoring` column; an explicit
virtual `false` supplies the absent household policy to current fixture callers.
This value is never stored or included in historical receipt hashes. Production
always uses the complete current client, and historical fixtures reject a schema
where the new column already exists.

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
privileged application or filesystem modules, or the development fixture API
in `src/testing/fixture-api`; `check-architecture` enforces both.

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

List pages read the same context for many titles at once.
`GET /api/v2/targets/default?ids=<id>,<id>` takes up to 50 comma-separated media
IDs and returns `{schemaVersion: 2, items}` with one item per distinct ID, in
request order. An item is `{status: "ok", view}`, where `view` is exactly the
single read's response, or `{status: "unavailable", mediaId, code}`, where
`code` is the `media_not_found` or `forbidden` the single read fails with for
that title. One unavailable title never fails the batch. An empty list, a
malformed ID, or more than 50 IDs is a `400`. Every view comes from one
repeatable-read snapshot and a fixed number of queries, and the single read is
the batch read of one ID, so the two cannot disagree. In the browser, a list
makes one batch request per 50 titles and writes each view to the cache key the
title page reads; a row outside a list reads its own title.

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

Scoped movie publication creates cleanup from the exact verified successor,
including its edition and original physical publication. Cleanup observation
version 2 retains one movie edition, its current serving binding and the actual
immutable Plex completion; historical observation version 1 remains literal.
Network verifies that serving edition and active sessions before Files checks
the same snapshot, archive membership and journals. Keep and generation changes
protect the selected cut. Other editions retain their own requests and holds.
Imported-library household-history holds still require review before cleanup.
Cleanup policy time is independent of the original SDK, verification, storage,
writer and SQL deadlines; advancing policy time cannot renew an effect's proof.

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

Before rolling out a qualified Media API image, set `FLIPT_URL` to the intended
management endpoint and run this create-only bootstrap from the same qualified
source. Verify the created-key list and fresh scoped readback before the consumer
starts; preserve existing targeting and the acquisition hold through handoff.
An older repo Activity image and Flipt's seed initializer do not backfill newly
declared keys. Do not trigger the global inventory Workflow or use
`--apply-declared` for this step.

```sh
FLIPT_OPERATOR_TOKEN='op://v64ocnykdqju4ui6j6pua56xw4/flipt-auth/operator-token' \
  scripts/onepassword/with-service-account.sh \
  op run -- env -u OP_SERVICE_ACCOUNT_TOKEN \
  bun run check-flipt-flag-inventory -- \
  --apply-missing --environment prod --namespace media
```

The [API](src/server/index.ts) commits intent and an outbox row together. The
[outbox dispatcher](src/automation/store.ts) starts workflows using stable IDs;
a failed Temporal connection leaves the command available for later delivery.
Command creation and default outbox availability use UTC timestamps independently
of the database session timezone. Explicit future scheduling retains its supplied
instant; correcting defaults does not reschedule existing commands.
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

The production matcher invokes the self-contained `RegexOracle` executable from
`PATH` on Node or Bun. The image links `/usr/local/bin/RegexOracle` to the packaged
`/opt/media-regex/RegexOracle` binary. It uses .NET 10.0.11,
explicit `en-US` culture, a 25 ms regex deadline and a 60 second process deadline.
The production image excludes the .NET SDK. Input and output are bounded and
validated through a Node child-process protocol. Matching happens before database
locks; final guards use only exact pattern/input observations. New predicates
without observations protect until evidence is refreshed. Acquisition-referenced
candidate evidence stays immutable.

Native verification requires that same self-contained matcher on `PATH`; a
missing executable fails the check. From the repository root, publish with the
pinned SDK and runtime, retaining the entire output directory beside its binary:

```sh
MEDIA_REGEX_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/media-regex"
mise exec -- dotnet publish packages/media/scripts/regex-oracle/RegexOracle.csproj \
  --configuration Release --runtime osx-arm64 --self-contained true \
  --artifacts-path "$MEDIA_REGEX_CACHE/build" --output "$MEDIA_REGEX_CACHE/publish"
mkdir -p "$HOME/.local/bin"
ln -s "$MEDIA_REGEX_CACHE/publish/RegexOracle" "$HOME/.local/bin/RegexOracle"
```

Use the native runtime identifier (`osx-arm64`, `osx-x64`, `linux-arm64`, or
`linux-x64`) and an existing writable executable directory on your `PATH`.
The example assumes `$HOME/.local/bin` is on it; the link command refuses an
existing entry. The repository SDK pin and
[`RegexOracle.csproj`](scripts/regex-oracle/RegexOracle.csproj) runtime pin match
the image; no regex implementation is substituted for local checks.

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

New TV member evidence version 2 also accepts `Season 01/01.mkv` and
`Season01/E01.mkv` when one immediate explicit season directory identifies one
reserved canonical episode. The proof retains the exact torrent member path,
index, size and numbering digest. Conflicting filename/directory coordinates,
multiple season directories, missing mappings and unreserved episodes stay
protected. This shorthand does not infer absolute numbering or season-zero
specials. Full canonical and explicitly mapped absolute filenames retain their
existing interpretation; recorded version-1 plans and movie evidence keep their
original formats and revalidation behavior.

An explicit multi-season source such as `S01-S02` uses a separately retained
`assess_series_pack_v1` interpretation. It binds the original provider bytes,
complete bounded canonical seasons and current profile while preserving the
cached release's original attributes. Only an acquisition carrying that exact
interpretation can use the derived coverage; identity review does not override
missing consent, quality, or complete physical groups.

The bounded pack protocol stages up to four physical videos per Files Activity.
Every batch checks permission for the complete original episode set. Actual
prepared and completed Operations retain member descriptors and staged journals;
a separate seal assembles the complete, disjoint FilePlan. The first immutable
ready observation keeps its literal body and hash. Later observations may refresh
ratio, seeding time and transfer state while retaining the exact member inventory,
ownership, paths and native seeding policy.

Publication prepares up to four entries per Activity, then seals a complete
version-3 intent before the first forward effect. Physical batches extend one
causal journal. A final transaction publishes all database assets and the whole
outcome, using actual create/update acknowledgements and SQL checks against the
prepared inventory. While that intent is pending, current playback, cold Plex
verification, subtitle readiness, notifications and competing mutations remain
protected. Recorded inverse batches settle unfinished physical effects under
their own completed seal. Each Activity retains its original execution deadline
and one provenance allowance, including known SQL parent reads. Existing
version-1 callers and recorded Workflow histories retain their publication
protocol; transaction-held snapshot reuse remains bound to the exact transaction,
allowance and locked asset set.

Attributed edition text alone does not define an edition target or permit
replacing a different edition; the explicit movie choice supplies that scope.

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
bun scripts/migration-inventory.ts --capture sonarr --drain --base-url "$MEDIA_SOURCE_URL" --api-key-reference "$MEDIA_SOURCE_KEY_REFERENCE" --instance-id "$MEDIA_SOURCE_INSTANCE_HASH"
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

### Personal state import contract

The [personal migration service](src/migration/personal-state/service.ts) uses
persisted complete, stable captures and the existing owner-reviewed requester
bindings. `POST /api/v1/admin/migration/personal/preview` takes `captureIds`,
explicit `movieEditions: [{ mediaId, edition }]`, and `historyOnly` provenance
keys for obsolete source requests. Preview is read-only and repeatable. It
includes source monitoring masks, subtitle policies, exact claim dispositions,
and a hash of the captures, bindings, catalog, requests and library state.

To apply reviewed Seerr requests while other claimants are unresolved, first
preview the full capture, then preview again with `selectedSeerrRequests`
containing 1–100 exact `{ captureId, provenanceKey }` pairs from that review.
Pass the same selection and its new hash to apply. A scoped receipt accounts
only those reviewed requests. Omitted rows remain in the complete capture and
unresolved requests retain their existing protections. `historyOnly` entries
must belong to the selected requests when applying a scoped review.

`POST /api/v1/admin/migration/personal/apply` takes the same selection,
`previewHash`, `acknowledgeExistingLibraryKeep: true`, and
`acknowledgeTemporaryFollowingClaims: true`, with an `Idempotency-Key` header.
Changed evidence requires another preview. Existing native requests, including
cancellations and explicit Keep choices, are preserved. Imported claims are
Temporary/following. Seerr Approved and Completed are eligible; Completed means
source fulfillment, never that a viewer finished watching. Pending, declined,
failed and explicitly obsolete requests remain source history. Older captures
without raw statuses must be recaptured before activation.

Imported independent Plex accounts retain genuine source consent. Import does
not impersonate those accounts or create a native movie edition-choice audit.
`GET /api/v1/requests/imported` exposes the source/status and any pending movie
choice to the owner or the claim's own user. The requester makes that choice
through the existing movie detail flow. TV imports preserve selected season
requests, including explicitly selected specials.

The immutable `personal_state_imported` receipt accounts only its exact captured
record digest, reviewed requester binding, and real native request identities.
Once all relevant approved claims reconcile and library Keep defaults are
established, import releases only the generated
`migration_household_intent_review_required` hold. Unmapped or incomplete
claims retain protection; manual and other recovery holds remain intact. This
does not manufacture a household recovery release receipt.
Apply returns the immutable `eventId` and a `next` hold cursor. If non-null,
call `POST /api/v1/admin/migration/personal/reconcile` with `{eventId, after: next}`
and a fresh idempotency key, continuing until `next` is null. Each page inspects
at most 25 holds without extending ordinary transaction deadlines. Protected
rows remain held and can be reconsidered from `after: null` once evidence is
resolved. File adoption also reconciles its selected targets against existing
genuine personal-import receipts.

Initial-library v3 approvals may explicitly include `registeredAssets` with the
exact provenance key, passive asset ID/version zero, registration event ID,
registration hash, and `registrationRaw` containing its canonical JSON. This permits promotion only of that unchanged passive
registration. The existing Files checksum/probe, current Plex item/Part,
storage and stopped-writer proofs remain required. Already-corrected Plex
labels and reviewed named editions are preserved in place. No torrent or
acquisition is adopted. New imports begin with library Keep while preserving
any later explicit owner library policy. Optional `seriesMonitoring` masks
retain captured disabled seasons and per-episode overrides for future catalog
expansion; historical approvals retain their literal representations.

The `--drain` inventory above reads each manager's entire queue and active
commands twice. An empty stable result proves drainage, not stopped writers.
Use the existing `--baseline` comparison for the final manager/request/subtitle
delta, then the trusted legacy-writer observer for actual quiescence.

The [frozen playback reader](src/migration/personal-state/frozen-playback.ts)
normalizes a stopped Tautulli writer's consistent SQLite snapshot:

```sh
bun scripts/migration-playback.ts --sqlite /path/to/frozen-tautulli.db
```

For a stopped source read through existing storage tooling, pipe the complete
SQLite image to `--sqlite - --wal-settled` after independently proving its WAL
is empty/settled. Stdin is bounded and deserialized read-only in memory; no
credential-bearing database file is written. The flag acknowledges observed
source evidence and does not itself prove the writer stopped.

After the Network worker observes the stopped writers, run the frozen reader.
It opens SQLite read-only, requires zero active sessions, preserves every
ungrouped history ID, and returns validated rows, the observation boundary
(`through`), row count, and canonical snapshot digest. Import those rows in
bounded chunks. The owner-only `GET /api/v1/admin/playback/handoff` returns the
import version, count, digest, and latest stored `legacyWriterObservation`.
Compare the imported manifest to the frozen capture, then submit that
observation's `capturedAt` as `quiescenceCapturedAt` and its `inventoryDigest`
with the seal request. Sealing rechecks the current observation and active Plex
sessions. If the stored observation is absent or expired, obtain a fresh
Network observation. If the current observation is newer than the frozen
reader's `through`, read the same stopped source again, import its rows with
the new `through`, then verify the manifest and read the updated version
before retrying seal.
Existing session rows are never deduplicated by time or title, and this import
never changes Plex watched truth.

### Historical Plex views

The [Plex export](scripts/migration-plex-history.sql) reads retained movie and
episode views, including views of removed titles. It also reads Plex's
last-watched records when no retained view for the same account and GUID is as
recent. Those rows retain their original GUID and timestamp when Plex no longer
has a title.

Run the export against the intended Plex server's library database using its
bundled SQLite shell. Use the machine ID from that same Plex server's identity
response. Keep stdout private and require the SQLite read to succeed before
importing any batches.

```sh
set -o pipefail
"$plex_sqlite" -readonly -batch -bail -json "$plex_library_db" \
  < scripts/migration-plex-history.sql \
  | bun scripts/migration-plex-history.ts --server-machine-id "$plex_machine_id"
```

Send each validated JSON line to
`POST /api/v1/admin/playback/plex-history/import` with the current unrestricted
Media owner session and its CSRF token. Check that `imported + unchanged` equals
the number of records in each batch. Replaying identical view records is safe.
A different declared Plex machine ID or changes to previously imported source
rows cause the affected batch to be rejected.

**My requests** shows Plex records to the person bound to the verified account
at import. Replay the same batches after an account is verified to attach
previously unbound records. Changing account mappings never transfers prior
history to a different person. Plex history does not affect downloads,
library retention, or the play counts and watch time supplied by timed sessions.

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
Zimuku retain unknown flags rather than inferring them from a filename. An
admitted regular English or Simplified Chinese candidate with an unknown forced
flag requires independent dialogue-coverage proof before satisfying an explicit
regular target. Forced-only and constrained HI targets still require known
metadata; unsupported adapters reject them before claiming quota. Exact release
matching, human
provenance, timing and Simplified Chinese checks still apply. Unresolved imported
policy semantics remain protected even when a provider supports the individual
flags.

For SubHD, save the PinchTab base URL and token with the persistent browser
`profileId` in the owner provider API. Media reuses the running instance for
that profile or starts it when needed. Existing `instanceId` credentials can
still target an operator-managed instance. Browser challenges require human
interaction.

An existing owned but quality-unverified sidecar does not satisfy readiness and
is never silently overwritten by a newly accepted candidate. A canonical-path
collision ends the install with `subtitle_path_requires_owner_review`. Owners can
select an installed sidecar in the upload form at `/manage/subtitles` to create a
separate validated candidate without queuing installation. At
`/manage/subtitles/replacements`, select the current subtitle and candidate, prepare the file review, and approve
its exact observation and version. Only the same video, destination and subtitle
format are supported; embedded, unowned, cross-epoch and ambiguous files remain
protected. The video's version does not change.

The review page states where a replacement stands in one phrase per state
(`REPLACEMENT_STATE` in `src/client/subtitle-replacement/vocabulary.ts` is
exhaustive over the server's states), shows what is replaced, and asks in a
dialog before approving, naming the file and saying the page offers no undo. A
conflict says the title changed and nothing was applied; a request that got no
answer says the page cannot tell and offers the original action again, unchanged.
The fixture API serves one replacement in each state
(`src/testing/fixture-api/fixtures/movies/subtitle-replacements.ts`).

The movie replacement protocol uses a separate schema2 admission for
all registered cuts. `PrismaMovieSubtitleReplacements` binds owner upload and
review to the exact cut, current caption demand, unchanged video and actual
adoption, restoration, installation or prior replacement receipt. Files retains
the original Activity capability and caller-owned 100-record provenance budget
through the native swap. Its immutable receipt records both caption transitions,
the completed journal and original source; later publication and retention follow
the actual installation-to-replacement ancestry. An accepted replacement can
satisfy current caption targets and produce a personal ready notice from its own
receipt, with the existing readiness cohort dedupe and historical acknowledgement.
Owners select the edition's installed sidecar on the movie page, upload a
candidate and open its exact replacement review. The authenticated routes are
`GET /api/v2/media/:id/movie-editions/:edition/subtitle-target`,
`POST /api/v2/media/:id/movie-editions/:edition/subtitle-replacements/candidates`
and `POST /api/v2/media/:id/movie-editions/:edition/subtitle-replacements`.
The shared review displays the movie edition and binds approval to its current
version and observation hash. An acknowledged preparation opens that review;
it does not reselect the reserved video. Historical schema1 replacement inputs,
receipts and default administration retain their original meaning.

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

`/manage/migration` is one page in five numbered steps, with a list at the top
that says where each stands: add a capture, review each capture, build and
approve the library report, prepare files for adoption, and review and adopt.
Only the last step records ownership. It asks the owner to confirm in a dialog
that names how many files and Plex labels it will change, and says that the page
cannot undo it. Revoking a capture's approval also asks, because the page has no
way to approve that capture again. A refused review (`migration_review_stale`)
says nothing was saved and offers to load the current review. Hashes, epochs, and
source bindings sit behind each section's "Technical details". The fixture API
serves a capture, a report and a plan in each state for it
(`src/testing/fixture-api/fixtures/migration/migration.ts` and `handoff.ts`).

Owners can upload and review captures at `/manage/migration`. The API saves
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

For per-episode TV files, the owner can retry physical restoration or Plex
publication through the same interrupted-upgrade review. The retry observes the
exact previous executor's terminal run before atomically selecting a new
coordinator. It retains the original admission, inverse namespace, file journal,
completed restoration and deadlines. A running or unknown executor protects the
group. The effect Workflow receives only `schemaVersion`, `continuationId`,
`operationId` and `recoveryEpoch`; private completion and binding evidence stay
in PostgreSQL and the Activity process.

Uncertain filesystem journals, unproved storage replacements
and unresolved subtitle neighbors remain protected and require their separate
restore, rollback or ownership reconciliation paths. Recovery does not override missing Plex watch
evidence or authorize legacy torrent source deletion. Further bounded batches
can extend the current epoch; a later database restore must reprove the files
again against its new epoch and the prior native or legacy storage receipt.
