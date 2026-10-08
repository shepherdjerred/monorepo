# Scout Backend

The Scout for LoL backend service. One Bun image that runs:

- The Discord bot (Discord.js): slash commands, match notifications, report delivery
- Match polling cron jobs through Scout's native Riot API client, with raw match JSON archived to S3
- The tRPC/HTTP server that the web app SPA (`@scout-for-lol/app`) calls
- The DuckDB "report lake" (Parquet, derived from S3) that executes ScoutQL report queries
- Server-side product analytics (PostHog) and metrics (Prometheus) / error tracking (Sentry)

One image, but not necessarily one process: see [Runtime roles](#runtime-roles).

Application state (subscriptions, competitions, guilds) is PostgreSQL 16
managed by Prisma (`@prisma/adapter-pg`). Report images are rendered by
`@scout-for-lol/report`.

## Support messages

`SupportConversation` joins web feedback, private Discord forms, and bot DMs by
Discord identity within each environment. `Feedback` holds inbound and human
outbound messages. Bot DMs do not require a web account; signing in later with
the same Discord identity exposes that history. The gateway subscribes only to
direct-message events, with partial channels enabled, not guild message content.
Gateway message/interaction IDs and web UUIDs deduplicate retries. Intake uses
a per-sender transaction lock, ten-message-per-minute limit, and five-upload-
per-minute limit backed by minimal sender throttle and alert-grouping state that
survives conversation deletion, plus operator mute. Discord DM and web screenshot
uploads share the same sender quota. A database trigger adopts feedback inserted
by older pods during a rolling deployment, so the one-time data migration does
not leave late legacy submissions detached from the inbox.

`/app/feedback` is the permanent composer and reply history. Operations' inbox
uses the structural operator allowlist independently of the pipeline console
flag; ordinary server admins cannot read it. Read, waiting-on-user, and resolved
are separate states; an inbound follow-up reopens the conversation. Replies are
committed to web history before notification work, so blocked Discord DMs never
hide an answer. Notification delivery, mute changes, and deletion serialize on
the same sender lock, so no notification can arrive after deletion commits.
Reply request IDs prevent duplicate replies.

`SupportJob` is the durable outbox. Intake groups operator alerts and DM receipts
in five-minute windows. A prompt Temporal start drains work; the one-minute
`support-inbox` Schedule recovers missed starts and stale claims. Discord sends
are at-most-once attempts: interrupted/ambiguous outcomes become `UNKNOWN`, never
automatic resends. Storage work uses deterministic keys and bounded retries.
Operations shows delivery failures and detached file-deletion failures, with
retry controls only for repeatable storage work. DM audit content is redacted.

Screenshots accept PNG/JPEG/WebP up to 10 MiB, five per message. Web uploads
reserve a private object key before I/O; bot attachments archive only allowlisted
Discord CDN URLs, with no redirects and bounded byte counts. Successful copies
clear the expiring source URL. Private `scout-support-beta`/`scout-support-prod`
buckets are backed up separately from disposable report images. The bootstrap
`SUPPORT_BUCKET_NAME` selects the bucket; image reads authenticate ownership or
the operator allowlist, validate stored bytes, and return private/no-store headers.
Accepted content remains until confirmed manual deletion. Deletion fences
archive work, removes active records, and durably queues file cleanup. Unsubmitted
uploads expire after 24 hours. Backups follow existing rotation; conversation
deletion removes message and attachment content but retains the sender ID,
recent inbound/upload timestamps, and five-minute alert/receipt grouping
timestamps needed to preserve abuse controls. Failure notices to a sender are
coalesced to one per minute, with only the latest notice timestamp retained.
Muted senders also retain their minimal restriction state.

`scout_support_conversations_enabled` gates new Discord controls, screenshots,
operator alerts, and reply DMs; stored web messages remain readable and bot DM
intake still gets receipts. `scout_support_report_action_enabled` additionally
controls the passive report feedback button. Delivery freezes that button with the
notification presentation before delivery. These controls create no additional
outreach messages and do not change existing outreach budgets. Fourteen-day
Operations measurements exclude operator conversations and count report actions
delivered/opened/submitted; delivery is not an impression. Analytics never carry
support text, attachment URLs, or screenshot bytes.

Feedback links derive from the application origin. `/help`, website support,
the permanent form, and existing occasional outreach route to this conversation;
GitHub issues and personal developer DMs are not support entrypoints. The
community Discord is optional and is not mirrored into private support.

## Commands

```bash
bun run dev              # Start with hot reload
bun run start            # Start once (the `combined` role)
bun run start:application    # Web surface, interactive + lake workers, report lake
bun run start:gateway        # Discord gateway, commands, voice
bun run start:activity-worker  # Realtime + background activity workers
bun run build            # Bundle to dist/

bun run test             # bun test; each test clones a hash-scoped template database
bun run typecheck        # tsc --noEmit
bun run lint             # ESLint
bun run format           # Prettier check

bun run db:generate      # Generate the Prisma client (+ branded types)
bun run db:push          # Push schema to the shared local dev Postgres (development)
bun run db:migrate       # Create/apply migrations (prisma migrate dev)
bun run db:studio        # Open Prisma Studio

bun run docker:build     # Build the backend Docker image (repo-root context)
bun run smoke            # Smoke-test the built image
bun run compact:report-lake  # Manually fold/rebuild the DuckDB report lake
```

Hosted application and activity-worker pods reserve the report-lake baseline.
Activity workers reserve 2 GiB; the gateway reserves 3 GiB because it also owns
the voice runtime. Each role has an 8 GiB process limit and its own DuckDB
scratch space.

Report-lake rebuilds buffer at most 1 MiB of NDJSON per writer, except for a
single oversized document, which is drained immediately. Every producer awaits
disk backpressure before writing more rows, including the raw source documents
needed to rebuild the lake.
Rebuilds and incremental folds feed Parquet COPY at most 64 MiB of encoded
NDJSON per batch, except for a single oversized record. Input batches preserve
record boundaries, UTF-8, and numeric precision. COPY appends unique Parquet
files, flushes partition buffers every 2,048 rows, keeps at most four output
writers open, and targets 8 MB row groups. Bounding both the input reader and
output writers keeps wide documents within the existing DuckDB budget.

The GitOps child sync wait covers the same 40-minute cold-start budget as the
startup probe, plus five minutes for readiness and subsequent sync waves.

### Durable Temporal work

Community MVP votes commit a `MatchMvpTallyRefresh` row in the same database
transaction as the ballot. One row per match and guild tracks the desired and
applied tally revisions. The gateway attempts a prompt edit after acknowledging
the voter; the `mvp-tally-refresh` Temporal Schedule sweeps pending rows each
minute on beta and production, including rows left by a gateway restart.
Workers claim a short database lease, replace the tally embed idempotently,
and leave a newer revision pending if another vote arrives during the edit. A
late worker requeues its stale edit through a generation check, even when an
active worker is completing the same vote revision. Each successful target
edit is checkpointed against the claimed revision and generation, so a partial
failure retries only unfinished targets. An in-flight edit is recorded as an
unknown outcome until it is checkpointed; replacing the embed makes a crash
retry safe. A new delivered report target reopens an applied tally in the same
transaction that records its message reference. Missing report refs remain
pending until all postmatch intents record a terminal no-send outcome, when
the request is recorded as `report-unavailable`. A later vote reopens it.

The vote button also records its report message's guild in
`MatchMvpReportTarget`. That ownership remains available after Discord deletes
the channel or revokes access, so a permanent failure is checkpointed for the
target without guessing its guild from the match-global report reference map.
When every known target for the voting guild is permanently unavailable, the
request closes with `report-target-unavailable`; an uncertain edit still
retries. A newly recorded report reference reopens a closed request.
The migration recovers older target ownership from prior edit checkpoints and
unambiguous subscription channel mappings. It closes pre-upgrade requests
whose stored refs have no provable guild target with
`legacy-target-ownership-unknown` for operator review. A later observed owned
target reopens the request even when its report ref was already stored.

Operators can inspect `"MatchMvpTallyRefresh"` for `pending = true` rows and
`lastErrorCode` values `awaiting-report`, `discord-target-unavailable`,
`discord-edit-unknown`, `report-unavailable`, or
`report-target-unavailable`, or `legacy-target-ownership-unknown`. Compare `desiredRevision`
with `appliedRevision` before
closing an incident; a recorded vote alone does not prove the Discord tally
was edited.

Detached prediction and parlay work is inserted once before its Temporal
workflow starts. Reconciliation starts only never-accepted `queued` rows.
After Temporal exhausts the activity's four-attempt budget, the row remains
terminal `failed`; normal producers cannot restart the same work ID. The
champion-mastery refresh producer is the sole exception: a later champion-page
visit atomically requeues the same failed refresh with its newly validated
payload, then requests a new start. This lets an expected Riot outage recover
without an operator action while preserving the durable work identity.

An operator may explicitly requeue one reviewed failed row. The command is a
dry run unless `--confirm` is supplied, requires a reason, and atomically
records the reason and increments the row's requeue count:

```bash
bun run temporal:requeue-work -- \
  --work-id parlay:<match-id> \
  --reason "Provider capacity restored and this match was reviewed"
```

`db:generate` must run after schema changes and before typecheck/test; from the
Scout root, `mise run generate` does the same thing.

## Explore agent skills

The Explore agent's system prompt is a lean core — corpus honesty, answer
shape, limits — plus an index of skills. Everything domain-specific (ScoutQL
itself, visualization kinds, match cards, League references, Riot acquisition,
game review, player tendencies, patch impact, champion pools, voice response,
dares, challenges, creation, Bryan Bucks) is a Markdown file under
`src/explore/skills/content/` that the model
loads on demand with the `load_skill` tool, mirroring the Agent Skills
pattern. Adding a skill is adding one `.md` file: the loader discovers files
by directory listing, and frontmatter (`name`, `description`, `capability`,
`surfaces`, `tripwires`) controls when it appears in the index.

Two invariants worth knowing before editing a skill:

- `{{placeholder}}` tokens keep generated content unforked. The ScoutQL field
  guide and language reference render from the same catalogs the report
  editor and docs read (`skills/registry.ts` owns the provider map), and
  `{{currentTime}}` injects the turn timestamp — which is also why the system
  prompt itself stays byte-stable for provider prompt caching.
- Tripwires are the rules that must hold even when a body is never loaded
  ("a prepared confirmation is a proposal, not an entity"); they render in
  the core prompt for every turn where the skill is enabled. Exact loaded
  bodies and tool inputs/outputs are persisted in `ExploreToolPayload`.
  Stream previews remain bounded; owners can fetch complete payloads on demand.
  Shared reads check the current token and frozen branch on every request,
  project public analytical evidence, and redact private tool contracts.

### Complete datasets and isolated analysis

`scout-explore-analysis-enabled` gates the data-analysis skill and tools.
`materialize_query_dataset` retains every selected row (up to 50,000);
`materialize_raw_documents` reads captured match, prematch and timeline JSON
for those match IDs. Raw documents preserve unknown fields, nested arrays,
nulls and original identities with a separate remap. Spectator credentials
are excluded. Source key, digest and capture time identify each capture;
missing documents are reported explicitly, without acquiring new Riot data.

Datasets belong to one run, have immutable names, and share a 64 MiB turn
limit. Their generation identifies both the published build and committed
staging snapshot; a change requires repeating the selection. Schema discovery
and validated JSON paths expose nested fields without evaluating expressions.
The JavaScript tool runs QuickJS in WebAssembly inside a terminated Bun worker:
10 seconds, 256 MiB, 64 KiB output, four executions per turn, and two global
leases in PostgreSQL. It exposes datasets and synchronous JSON results; no
host functions, imports, filesystem, network or credentials are installed.

The lake fingerprint includes `raw_documents`. Rebuild the lake from canonical
storage before enabling analysis against an older build. Rebuild and compaction
publish raw documents together with the existing projections. Version 2 staging
receipts attest this larger projection; existing version 1 receipts keep their
original meaning.

### Model choice and spending

`scout-explore-model-picker-enabled` offers GPT-6 Luna and GPT-6.1 Sol with
high reasoning. The conversation remembers the choice; each answer records
its model and reasoning setting. Legacy clients retain their strict SSE and
REST contracts; version 3 transcript reads include the new metadata.

The typed `scout-explore-spend-policy` defaults to $20 shared per UTC month,
$5 per user per month and $0.50 per turn. PostgreSQL reservations in integer
microdollars precede every provider step and repair, with retries disabled.
Actual usage includes cached input and hidden reasoning output. Missing usage
or an uncertain response keeps its maximum hold; stopping or restarting a run
does not refund that hold. Quotas and active-run admission are durable: one
active turn per user, five globally, and the same policy supplies the UI counts.
Each call has a conservative 256,000-token input bound computed from UTF-8
bytes of the complete prompt and tool schemas plus framing overhead; available
spending can impose a smaller limit. Dataset contents stay outside the prompt
unless a tool explicitly selects or summarizes them.

## Durable match facts

`src/durable/match/` holds the typed services the per-match pipeline shares:
the receipt evidence vocabulary (`receipt-evidence.ts`), the notification
intent keys (`delivery-intents.ts`), the
`ScoutWorkflowStart` request record (`workflow-start-facts.ts`), intent expiry
and audience retirement, and the tracked-account association builder
(`archive-facts.ts`). The durable tables they write are `MatchObservation`,
`MatchTrackedAccount`, `MatchProcessingReceipt`, `MatchNotificationIntent` and
`ScoutWorkflowStart`.

Writes that RECORD an effect decided elsewhere go through the fail-open
boundary in `durable-facts.ts`: the `ScoutWorkflowStart` request rows and the
receipted lake staging. A recorder outage
can never throw into the effect it describes. Writes the pipeline decides from
are strict instead; see [The per-match core](#the-per-match-core).
`ScoutEffectClaim` is the at-most-once guard for an effect, and a notification
intent is keyed by the same string as its send's claim, so the two describe
the same send.

Receipt evidence names things by durable identity — Discord message ids, ledger
row ids, object key plus content digest — never by a count or a local path, so
a reader can go find what the receipt attests to. No evidence carries a money
amount; the identities locate the ledger rows and the amounts live there under
the storable Bucks brands. The `raw-archive` and `lake-staging` receipt kinds
belong to the receipted lake projection in `report-lake/`, which records them
from the writer that knows the artifact's key and digest; the two vocabularies
are disjoint, so no receipt identity carries two evidence shapes.

Raw-archive evidence is at version 2 and names the artifact by identity alone:
kind, key, digest, byte count and content type. The capture instant is
observational and travels as the receipt's own `recordedAt`, so two
attestations of the same bytes agree however far apart they were stamped.
Version-1 rows — beta and production hold them — carried the whole descriptor,
and `rawArchiveDescriptorOf` reads each row's capture instant the way its own
version wrote it rather than re-dating old artifacts from a column that meant
something slightly different at the time.

`MatchObservation`'s artifact columns are stamped from that same archive.
`commitMatchObservation` reads the standing `raw-archive-match` receipt
(`readArchivedMatchArtifact`), so the stored key and digest are what the put
actually wrote rather than a key rebuilt from the layout convention. They stay
NULL when no object was written (no bucket configured), which is exactly what
NULL means there.

Two metrics count the recording writes, both defined once in
`src/metrics/durable.ts` — prom-client throws at import time on a duplicate
metric name, so a second definition site takes the process down on boot rather
than at the first `inc()`:

- `scout_durable_dualwrite_records_total{write_kind, outcome}` — facts
  recorded, by repository answer (`applied`, `already-applied`, `adopted`,
  `conflict`).
- `scout_durable_dualwrite_failures_total{write_kind}` — writes that failed and
  were swallowed. Non-zero means the durable record is behind what the system
  actually did. The `dualwrite` word is the name the metrics were introduced
  under, kept so dashboards and alerts keep reading them. These failures deliberately do not reach Sentry: an outage
  would raise one event per write per channel per match and bury the errors
  that actually stop work.

Both are per-write counters incremented by whichever runtime role executed the
write, so a parity dashboard joins across roles rather than reading one
process. Neither is derived from a database sweep, so neither belongs in
`getMetrics()`'s `databaseMetricSweepsEnabled()` block.

`write_kind` comes from the single closed set in
`src/durable/match/durable-facts.ts`, which covers the receipted lake
projection's kinds as well as the per-match services'; a new recording site
adds a member there rather than passing a free-form string. `outcome` is parsed
from the repository's own answer before it becomes a label. The two fail-open
wrappers — `recordDurableWrite` and `recordReceiptFailOpen` — refuse to nest,
because both count a completed write and nesting them would report one fact
twice.

## Durable pipeline observability

The recording counters above say what the pipeline _did_. Seven more families
in `src/metrics/durable-pipeline.ts` — likewise a single definition site — say
what it is still _holding_:

- `scout_durable_notification_intents{state}` — intents per state of the domain
  machine, zero-filled across all nine. `state="unknown-delivery"` is the
  operator dead end and the unknown-delivery count in its own right.
- `scout_durable_recovery_batches{state}` — batches per state, zero-filled
  across all six.
- `scout_durable_backlog_oldest_age_seconds{family}` — age of the oldest row in
  `stalled-match-processing`, `live-recovery-batches`,
  `unaccepted-workflow-starts`, and `ready-notification-intents`. Only backlogs
  whose ordering column is a true age are here; stalled notifications sort by
  freshness deadline, so their head is the intent closest to expiring rather
  than the one waiting longest, and their depth lives on the intent gauge
  instead. The ready family is one state read by `createdAt`, excluding intents
  a recovery batch policy holds, so its head is the longest-waiting send.
- `scout_durable_observation_lag_seconds{statistic}` — `p90` and `max` of
  observation time minus game START for live FULL matches observed in the last
  two hours. The observation row stores no game end, so this includes the
  game's own length (healthy p90 is about 40–45 minutes). An empty window reads
  0, so it does not detect discovery that has stopped outright.
- `scout_durable_postmatch_mint_gaps` — live matches observed in the last six
  hours whose cursors all advanced at least 15 minutes ago, with an unmuted,
  unfiltered subscription owed a report, but no postmatch intent and no
  postmatch render receipt. It under-counts on purpose: queue-filtered
  subscriptions need the match's queue type, which only the raw match JSON
  holds. The silent post-match backfill's render receipts clear it.
- `scout_durable_lake_staging_lag_seconds{artifact_kind}` — how long the
  longest-unprojected archived artifact has waited for its staging receipt, per
  artifact kind because the three fail independently.
- `scout_durable_receipts_recorded_total{receipt_kind, outcome}` — incremented
  in `recordReceipt`, the one funnel every receipt write passes through, so a
  receipt kind added by a later wave is observable the day it is written.

Every label draws from a closed vocabulary — the two state sets come from the
exhaustive classification tables in `database/durable/pipeline-scan.ts`, so a
state added to a domain union fails to compile until the sweep covers it. No
match id, guild id, or intent key is ever a label.

The gauges are swept from the database at scrape time and so belong to the one
role with `databaseMetricSweeps` (see the runtime roles section). The lake lag
is swept by `report-lake/`, and the mint gap by
`temporal/notification/postmatch-mint-gap.ts`, because their receipt-kind
vocabularies live there and `architecture.config.ts` forbids `metrics/` from
importing those layers; each registers through `metrics/sweep-registry.ts`,
which exists for exactly that inversion. `metrics/sweeps.ts` is the list of everything a
sweep-owning scrape runs.

Every metric also carries a `role` default label, from the runtime-role enum.
That is what lets an alert say which pods it is asking about — most sharply for
`discord_connection_status`, which a gateway-less pod reports as a truthful 0,
so an unscoped `min by (environment)` reads a correct deployment as an outage.

## The per-match core

`src/temporal/` holds the Activities `scoutMatchProcessingWorkflow` calls. They
are thin orchestration over shared services — the receipted archive door, the
Bucks settlement hook, the challenge advisory lock, the durable repositories —
and their durable writes are strict, not fail-open.

The durable record IS the pipeline's memory: a resumed Workflow decides which
phases already happened by reading it back. A write that quietly failed there
would send the next run to re-apply an effect it cannot see. So the Activities
go to the repositories directly and report the repository's own answer, and an
unwritable record fails the Activity for Temporal to retry.

Two vocabularies live alongside each other for the same reason. The
evidence-bearing receipts (`settlement`, `progression`, `raw-archive-match`)
say WHAT happened and are written by the phase that has the evidence. The
stage receipts (`v2-match-*`, declared in `@scout-for-lol/temporal`'s
`match-receipts.ts`) say WHICH PHASE this owner completed, carry evidence
derived from the match reference alone, and are what the resume point reads.
A resumed run cannot reconstruct settled bet ids, so it could never re-assert
an evidence-bearing receipt without either inventing evidence or recording a
conflict against the first writer's.

A contested stage receipt is made durable before it fails anything. The
Workflow fails the run that meets one, but a failed execution is not durable:
under `ALLOW_DUPLICATE_FAILED_ONLY` the next discovery starts a fresh execution
whose resume read sees the standing kind without the outcome that contested
it, and would skip the phase and advance the cursor over the same drift one
poll later. So `recordMatchReceipts` records `v2-match-stage-conflict` — the
same shape as the recovery tail's `v2-recovery-conflict`, evidence naming the
match alone — and every later execution refuses at its resume point until an
operator has looked and removed the marker. The reconciliation sweep leaves
such a match alone (it would start a failing child per tick); the operator
listing and the backlog gauge still show it, because it is exactly what a
person needs to see.

A match the retired v1 pipeline observed keeps its `legacy-v1` owner and
`LEGACY_V1` row. `commitMatchObservation` claims `temporal-v2` for every new
match; a match another owner holds answers `ownership-held-by-another-owner`,
and the Workflow reports the stored owner and stops before settlement rather
than re-applying that owner's effects. Those rows are never rewritten to
`TEMPORAL_V2`: the stalled-match scan would sweep thousands of historical
matches into processing children and redeliver them. `readLegacyMatchCompletionV2`
answers `completed: true` for them (`src/temporal/match/legacy-completion.ts`),
whatever the closed v1 execution's status, and logs that status once per match.
Nothing will process those matches again, so a v1 run that FAILED or was
TERMINATED mid-stage is accepted data loss; waiting on it would wedge the
serialized client-match dispatcher, and the binding projectors late binding
runs instead are idempotent.

The core refuses a match whose discovering account is no longer tracked:
discovery carries the source account into the per-match input, and
`commitMatchObservation` fails non-retryably before any effect unless it is
still tracked and in the match. A run started without a source, which is what
a reconciliation restart is, resumes an observation that already passed it.
The account cursor is the last Activity, after the stage receipts, and outside
the progression lock; `match.ts` records the three facts behind that ruling.

### The post-match poll is owned for a whole run

`BotState.pollStatus` says whether a post-match poll is in flight. A poll spans
a WORKFLOW: discovery, every match child it awaits in turn, and the maintenance
that closes the poll at the end. A worker-local flag cannot span that, because
it is released the moment the discovery Activity returns. A second discovery
starting in that window — an operator's, against a scheduled run still working
through its children — would otherwise open a poll of its own, and the first
run's maintenance would then mark that NEWER poll complete underneath it.

So discovery takes a DURABLE claim (`claimPostMatchPoll`), and the claim's
identity — the instant it was claimed at — rides the scan result through the
Workflow to the maintenance call, which closes only the poll that identity
names. An overlapping discovery is told the poll is held and reports `skipped`,
which the Workflow already treats as "opened nothing, so close nothing".
Maintenance requires that identity: there is no unowned close. A run
whose claim was taken over closes nothing and fails the Activity
non-retryably, because the poll it meant to close is someone else's and the
identity cannot come back. Takeover needs the claim to have stood past a
30-minute bound, which only a TERMINATED run can do: a worker that dies is
replaced from history, its children keep running, and its maintenance still
releases the claim. `post-match-poll-ownership.integration.test.ts` proves the
claim and the guarded close against a real Postgres; `match.test.ts` proves
the overlap end to end, with the second discovery starting while the first is
awaiting a child.

### Post-match discovery patches

No discovery recorded while the retired ownership read existed is still
running, but closed histories stay retained for the namespace's 30 days and
are replayed against a candidate bundle before promotion. So
`scoutPostMatchDiscoveryWorkflow` still replays the read for those histories
(`replayRetiredPostmatchOwnershipRead` in the Scout Temporal package's
`workflows/retired-ownership.ts`), runs recorded since carry the
`scout-v2-retired-postmatch-ownership` marker, and the realtime worker still
answers the read with `run-v2`. `match-replay.test.ts` replays committed
fixtures of both generations. Once no history predating the retirement is
retained, the gate becomes `deprecatePatch` of the retired marker.

`ScoutEffectClaim` keeps taking the top-level Prisma client, and
`src/temporal/effect-claims.ts` carries the reason: `claimScoutEffect` is an
insert that expects to fail and then READS the existing row back, and in
Postgres a constraint violation aborts the surrounding transaction, so the
read-back could not run inside one. The guard and the fact are therefore two
commits by construction, which is why every guarded-effect result reports
them as separate outcomes and names the reconcile.

### Renamed pipeline types, staged across releases

The pipeline's Workflow and Activity functions lost their `V2` suffix
(`scoutMatchProcessingWorkflow`, `commitMatchObservation`). A type name is
identity in Temporal: replay checks every recorded command by type, and a
worker resolves a Workflow or Activity by its name. The workers that can run
Scout Workflows deploy independently — beta's routed Worker Deployment build,
prod's embedded poller, the central worker that owns the Schedules — so a
name must be registered everywhere before anything issues it. The rename
therefore lands in steps.

This release registers both names and issues only the old ones:

- `SCOUT_WORKFLOW_NAMES` still holds the `*V2Workflow` types, so Schedules,
  client starts and child starts issue them. The Workflow bundle exports each
  Workflow under its renamed function name and keeps the old name as an alias;
  `SCOUT_RENAMED_WORKFLOW_TYPES` maps one to the other.
- Pipeline Activities are scheduled under their old names
  (`preRenameActivities` in the Scout Temporal package's
  `workflows/generation-rename.ts`), and Activity workers register both names
  (`withPreRenameActivityNames`, composed in `registeredActivities` in
  `src/temporal/connected-runtime.ts`).
- The realtime worker also keeps the Activities a still-routed pre-rename
  bundle can schedule: the retired ownership reads, answering as they did once
  the ownership flags were retired, and the v1 Activities, which fail
  non-retryably (`src/temporal/retired-activities.ts`).
  `routed-bundle-activities.test.ts` checks every Activity the oldest routed
  build declares against this registration, and the central package's
  `scout-schedule-workflow-types.test.ts` checks every Scout Schedule type
  against this bundle and the routed one.
- `ScoutWorkflowStart` rows keep the type they were written with, so the
  reconciliation sweep, the operator listing and the backlog gauge filter on
  both names (`SCOUT_PIPELINE_START_WORKFLOW_TYPES`).

`generation-rename-replay.test.ts` replays a dispatcher and a match run
recorded mid-flight under the old names, and shows a run recorded now issues
the same names. The next step switches issuance to the new names — Schedules,
`SCOUT_WORKFLOW_NAMES`, and child and Activity types behind a patch so open
histories keep replaying — once every routed bundle and the prod backend image
register them. A later step drops the aliases and the retired Activities.
Workflow IDs, signal names, codec kinds and Schedule IDs that contain `v2` are
identities and stay as they are, and so does `readLegacyMatchCompletionV2`,
which open histories recorded.

## Scout Client player identity

The League client names every player by a 36-character UUID — in the
current-summoner profile, lobbies, match history, end-of-game blocks, and
replay files alike. Riot's API names them by a 78-character PUUID encrypted
per API key, which is what every `Account` row and every Riot-sourced record
holds. The two never compare equal, so client data joins to nothing until it
is translated.

`LeagueIdentityAlias` is that translation (`scout-client/identity-alias.ts`).
An alias is learned by resolving the Riot ID a payload states beside a UUID
(`gameName#tagLine`, present in the profile and in match-history identities)
through account-v1, once per player, and cached for good. Ingress learns
every alias a batch can teach before checking it, then:

- translates the observer before the ownership check, and stores the PUUID in
  `localPuuid` with the UUID beside it in `localLcuUuid`;
- leaves the stored payload as sent — it is the evidence — except for
  credential-named keys (`withoutScoutClientCredentials`, driven by the shared
  contract's `credentialKeyFragments`), which an older client still sends and
  which are never stored or read; the idempotency digest covers the observation
  exactly as sent, so a retry still matches its first copy;
- hands a translated copy of that payload to the quarantine checks, lobby
  binding, and match dispatch.

Every later reader of a stored payload translates its own copy the same way
(`withRiotIdentities`): canonical match selection, replay provenance and the
replay container check, and local mastery. A UUID with no alias is left as it
is, so an unresolved player fails to join rather than joining wrongly, and a
canonical match that still names anyone by UUID is refused.

A client can claim any Riot ID for a UUID; ownership is still checked against
the device owner's accounts. An alias whose PUUID is the reporting owner's
own is `ownerVerified` and replaces an unverified one, so a player's own
client corrects anything another client's payload taught. Outcomes are counted
in `scout_client_identity_aliases_total{outcome}`.

### Client-sourced matches and their timelines

A post-game bundle carries the League client's full `games/{id}` — every
participant — beside the end-of-game block, and its `game-timelines/{id}`.
`canonical/lcu-match.ts` converts the first two into a Match-V5 match and
`canonical/lcu-timeline.ts` the timeline into a Match-V5 timeline, both tagged
`dataVersion: "local-1"`. What the League client doesn't report stays absent
rather than appearing as a zero: `gameName`; rune stat shards (`perks.statPerks`,
so the Explore loadout shows no shard list); item, skill and ward events;
per-frame champion and damage stats; gold per second; and crowd-control time.
`championName` is the champion key for the stated ID (`MonkeyKing`), since the
end-of-game block's own value is the display name (`Wukong`). The League
client stamps every timeline event with every field, so each event type keeps
only the fields Match-V5 gives it. A "first" objective the payload doesn't state
is derived only when provable — from kill counts, or the timeline's first kill
when both teams took one — and a match whose required "first" can't be proven
is refused.

Once a client payload is a match's canonical one, its timeline comes from that
client too. `fetchAndRecordTimeline` (`match-report-standard.ts`) checks
`readTimelineSelection` before asking Riot, so the report render, Dares,
challenges, duels, and late binding all read the client's timeline without
knowing its source, and it is staged into the lake as `timeline_scout_client`.
A client that sent no timeline is a final miss rather than a retry, because Riot
can't see the game and none is ever coming: Dares record missing coverage and
duels go to organizer review.

### Replay files

`scout-client/replay-upload.ts` accepts a `.rofl` only after the container
check (`replay/container.ts`) ties it to evidence: its SHA-256 matches the
declared digest, its player is the uploader's (through the alias table), and
its build is the observed match's. Builds are compared part by part as numbers,
because a replay header zero-pads the revision (`16.19.823.0722`) where the match
states it bare (`16.19.823.722`).

The verified file is then streamed to object storage. The shared S3 client
(`storage/s3-client.ts`) checksums only when an operation requires it; the
SDK's default per-request checksum cannot hash a streamed body and failed every
replay upload. A failure that isn't a typed rejection is recorded on the
artifact's `lastError` with its own message, and the upload is `FAILED`, which
the device retries; a `REJECTED` upload is final.

## The prematch path

The `prematch-*` modules serve `scoutPrematchDiscoveryWorkflow` and
`scoutPrematchGameWorkflow`, and they are shaped differently from the
per-match core on purpose.

There is no resume-point read, because there is nothing for one to answer: the
pipeline-state aggregate hangs off `MatchObservation`, and a live game has not
been observed yet by definition. The per-game Workflow has one phase instead of
four, so its replay gate is the receipts themselves — the archive's inside the
door (below), the lake projection's inside `archivePrematchSnapshot`. There
are also no stage receipts here: those exist so a resumed run can gate a phase
whose evidence it cannot reconstruct, and the two evidence-bearing receipts
this path writes already answer exactly the question it asks.

### Prematch detection and maintenance

The `prematch-poll` Schedule starts `scoutPrematchDiscoveryWorkflow` (under its
pre-rename type, `scoutPrematchDiscoveryV2Workflow`) every
30 seconds in every stage, with a `SKIP` overlap policy and a one-minute
catch-up window: a poll that outlives its interval drops the tick behind it,
and a tick the server missed by more than a minute is not replayed. Each poll
detects live games, starts one `scoutPrematchGameWorkflow` per game, and
then runs `runPrematchMaintenance`
(`src/temporal/prematch/prematch-maintenance.ts`): Dare accept-window expiry
and callout refresh, and, unless betting is hard-disabled, parlay market
activation and betting and parlay window closes. Discovery records one
`prematch_detections_total{status}` sample per probed account (`game`,
`idle`, `unreadable`). The maintenance tail sits behind the
`scout-v2-prematch-maintenance` patch. It stays `patched` until no closed poll
history recorded before the tail is retained, because retained histories are
replayed before promotion and one of them completed where the tail now runs.

Notification intents are keyed `prematch-discord:<matchId>:<channelId>`, a
delivered or `unknown-delivery` intent is never redriven, and betting pools are
unique per match and guild.

The consumer live view reads `listLivePrematchGames`
(`src/temporal/prematch/prematch-reads.ts`): `raw-archive-prematch` receipts
younger than `LIVE_GAME_TTL_MS` (three hours,
`src/temporal/prematch/prematch-intents.ts`), minus games the report lake
already holds, with each roster read from the archived spectator snapshot. The
stale-pool void sweep replies to the delivered post-match intents
(`postmatchReplyTargets`).

### Games against bots

Prematch detection waits out a spectator roster shorter than ten, because that
is nearly always a lobby still loading in. A game against bots looks the same and
never fills: Riot omits bots from the spectator roster entirely, so a custom
against nine of them reports one participant for its whole length. Only the
local Scout Client sees the rest, in the LCU lobby's `customTeam100` and
`customTeam200`.

`clientRosterCompletion` (`league/tasks/prematch/client-bot-roster.ts`) is the
one rule discovery and capture both ask through `isPrematchRosterReady`, and
they must agree for the reason given above. It answers only once the game has started (`gameLength >= 0`), so a
loading lobby still waits, and only when the client's bots leave somebody on
both sides. The bots come from the tracked player's own accepted observations
in two hops, because LCU never names the lobby and the game in one payload: the
client stamps the lobby it saw onto its in-game observation, and the roster is
read from that lobby as it stood when the game began. The desktop README
documents the client half.

Bots then render as ordinary participants with no PUUID, no summoner spells, a
hidden rank, and the lane the client assigned them. The lane-prior model reads
spells, so it does not infer lanes on a side bots share, and the full-side lane
rule in `LoadingScreenDataSchema` exempts that side for the same reason. A
completed roster is counted as
`prematch_detections_total{status="client_completed_roster"}`.

### Prematch delivery and markets

Behind the `scout-v2-prematch-delivery` patch, `scoutPrematchGameWorkflow`
does three things after its capture and plan:

1. `openPrematchMarkets` (`src/temporal/prematch/prematch-markets.ts`)
   makes the one-of-two Bucks decision behind the effect fence, with a
   `prematch-markets` receipt. A standard Classic lobby gets the participation
   point (`awardClassicPrematchForGame`, once per match and guild by its
   `BucksMatchEarning` marker). Any other bettable game gets one pool per
   Bucks-enabled guild it is announced in (`openBettingPoolsStrict`, once per
   match and guild by `BucksMatchPool`'s unique key). A failure is retried,
   stays visible in the history, and the game is still announced without a
   market.
2. One `scoutNotificationWorkflow` child per drivable prematch intent, with
   the post-match path's reuse policy. The plan leaves out delivered and
   `unknown-delivery` intents and any unsent intent past its freshness
   deadline.
3. Each child builds its message with its guild's buttons when that guild
   holds an open pool. After delivery, `afterNotificationDelivered` runs
   `prematch-follow-up.ts`: it appends the message to the pool's refs with a
   compare-and-set, refreshes the pool's messages, enqueues the parlay once
   per match and counts the guild's core output. A failed ref write is
   retried, because the ref is the settlement announcement's only destination.

Prematch and postmatch delivery freeze message content, embeds, buttons and
feature-tip selection in `NotificationPresentation` before sending. A guild
advisory lock serializes tip selection and claiming. Delivery confirms the
claim; a definitive terminal non-send releases it. Ambiguous delivery keeps it.
Retries reuse the saved presentation and never select another tip.

New prematch presentations freeze the guild's Clash decision. Render receipts
and S3 artifact keys include that guild and decision, so mixed-guild targeting
cannot share the wrong chrome. Older global render receipts retain their
original scope and remain readable.

The release procedure is maintained in the
[Scout Temporal rollout guide](https://wiki.sjer.red/how-to/roll-out-scout-temporal/).

### Durable state before live state

The capture consults its own archive BEFORE it asks Riot anything, and that
order is the correctness of every resumed run. The Activity has three durable
effects — the object, the lake projection, the notification intents — and a run
can die between any two. A live-first capture that died after archiving would,
once the game ended, be told "no such game", report an empty result and
complete; the projection would never be staged, the intents never minted, and
the completed game-scoped Workflow ID would seal all of it.

So a standing `raw-archive-prematch` receipt means this run resumes from the
ARCHIVED payload — read back by the receipt's key and verified against the
digest the receipt attested — and finishes the remaining phases from it without
Riot being involved. Those bytes are canonical by definition: S3 is the raw
store the report lake rebuilds from. A live absence is believed only when
nothing was ever archived, which is the one state in which it is informative.

The same principle shapes the spectator boundary itself. `getActiveGame` now
reports three outcomes rather than two: a confirmed `not-in-game` (Riot
answered 404), an `in-game` payload, and `unavailable` — a timeout, a 401, a
429, an upstream 5xx, or a payload that failed its schema. Those used to
collapse into one "no game" value, which is safe for a caller that re-polls on
a timer and fatal for one whose conclusion is durable. The capture throws on
`unavailable` and lets the Activity retry be its wait loop; discovery counts it
as an `unreadable` probe and the Explore current-opponent tool answers
`unavailable`, each stated explicitly at its call site rather than inherited
from a value that could not tell the difference.

It shapes the STORAGE boundary the resume path reads through too, where the
same collapse is available and just as costly. `ArchivedObjectUnusableError`
names the three ways an archived object cannot serve as the snapshot its
receipt attests — gone, digest-mismatched, or unparseable — each a fact about
what is stored that no retry changes, so each terminates the run. Every other
read failure is transport: a SeaweedFS timeout, a 5xx, a dropped connection,
none of which establish anything about whether the object is there. Those
propagate untouched and stay retryable, because terminating on one would
permanently strand an archived snapshot without its projection or its
notifications — once the game has ended, discovery cannot start another
execution to try again. The classification lives in `s3-raw-source.ts`, the
only layer that sees the SDK's error taxonomy, and the Activity translates it
into Temporal's retry vocabulary.

The capture stages the lake rows inline rather than deferring to
`stageLakeProjection`, which is the one place this path diverges from the
per-match core's separation of archive from projection. It has nowhere to defer
to: `scoutLakeProjectionWorkflow` is keyed by a match id and projects the
MatchV5 payload, which does not exist while the game is still being played.

### The archive door is fenced, for every artifact family

All three archive doors — match, timeline and prematch — take an advisory lock,
because all three share one hazard. Each family's S3 key is deterministic, one
per (match, kind), but the BYTES under it are not guaranteed identical across
two fetches. A prematch payload varies by construction, since `gameLength`
advances between polls. A MatchV5 response is semantically stable once the game
is over, but stability of meaning is not identity of bytes: serialization order
and late corrections both produce a different body for the same match, and a
retried or re-driven run can archive one match from two independent fetches.

An earlier revision of this section claimed match and timeline payloads were
immutable and left those doors unfenced. That was wrong, and the failure it
allowed is the one below.

Unfenced, the race is not merely a duplicated put. The second attempt
overwrites the object and only THEN discovers the receipt mismatch, so S3 ends
up holding the second capture's bytes under the first's attested digest — the
object and its attestation permanently disagree, which is precisely what the
receipt table exists to rule out. What differs between the families is only how
OFTEN the bytes vary; the fence costs one advisory lock around an infrequent
write either way, so there is nothing to trade.

The lock is keyed by (match, artifact kind), not by match alone: a match and
its timeline are separate objects under separate keys with separate receipts,
and making them wait for each other would buy nothing.

The prematch S3 key is keyed by the same identity as its lock and receipt: the
platform-qualified game id, `{platformId}_{gameId}`. A numeric game id is only
unique per platform, so a key built from the number alone let two platforms'
captures of one number on one day resolve to one object — the later put
overwrote the earlier platform's canonical bytes while the fence and the
receipt, keyed by the qualified id, saw two artifacts and let both through.
Objects written before the qualification sit under the bare number;
`report-store/s3-raw-source.ts` and the lake rebuild read both spellings and
take a prematch object's identity from its payload, never from its key.

Serializing alone would not fix that: an attempt that waited its turn and then
put anyway would still overwrite, just in an orderly fashion. So the lock wraps
the read-gate, the put and the attestation as one critical section, and an
artifact already archived is answered from its standing receipt with no put at
all. The fence lives in the DOOR rather than in any caller because several
callers enter through it — the per-match archive, the prematch capture, and the
report-store ingest the history imports use — and a fence at one call site would
serialize that caller against itself while leaving the race between callers
open.

The attestation is written through the fencing transaction so the arrangement
fails closed: an advisory xact lock dies with its transaction, and Prisma ends
one on its own timer as well as on its callback, so a put that outran the lock
lifetime would be running unfenced — and an aborted transaction cannot record a
receipt. No attestation is ever written for a put the fence could not vouch
for. `archive-fence.integration.test.ts` proves the serialization
against a real Postgres rather than a double, since a double would serialize by
construction and prove nothing.

The put — and the canonical read-back an `already_archived` answer needs — is
also bounded strictly INSIDE the lock's lifetime. The margin is not decoration:
an S3 put is not one request, and the SDK's request timeout multiplied by the
retry budget plus backoff can outlast the transaction on its own. Prisma
releases the lock on rollback without cancelling anything in flight, so an
unbounded put becomes a zombie — a rival takes the freed lock, writes and
attests its own bytes, and the zombie then lands the older body over them. The
deadline therefore both RACES the put (so the caller always settles inside the
lifetime) and ABORTS it through an `AbortSignal` the SDK honours (so the
request actually stops rather than being abandoned). A race alone would leave
the zombie running.

The deadline is derived, not fixed, and it is derived at the moment the
external work STARTS. The transaction's timer starts when it opens, before the
advisory-lock wait, so a follower that queued behind a holder has less lifetime
left than it started with — a fresh 25 seconds on 20 remaining is the zombie
again. Nor is the lock acquisition the last thing that spends lifetime before
the put: the read gate's receipt lookup sits between them, and it is a query on
a database that may be slow or contended, so a deadline captured when the lock
was acquired would hand the put a budget the lock can no longer cover. The door
starts a clock before the transaction opens, and each external operation takes
the smaller of the external deadline and the lifetime remaining WHEN IT BEGINS,
minus a settle margin reserved for the receipt insert and the commit; a caller
whose remainder fits no put fails closed before putting. Deriving inside the
call makes an early capture unrepresentable rather than merely avoided. The
wait itself is bounded by a `SET LOCAL lock_timeout` on the lock statement, so
a starved follower fails at the lock rather than spending its lifetime waiting.
All three are proved in `archive-fence.integration.test.ts` — a holder that
leaves without a receipt for the wait, an injected slow receipt lookup for the
derivation point. This mirrors the 600/900 split `temporal/effect-fence.ts`
documents for the same hazard.

Two contracts the fence must not change. The RECEIPT is fail-open and the put's
exclusivity is not: a receipt write that aborts the fencing transaction after
the canonical put landed is reported as `archived` with `receipt: "failed"` —
the object is in S3, the record of it is not, which is what that answer has
always meant — so a bookkeeping outage cannot turn a live ingest into a
failure, while a failure before the put still propagates. And with no bucket
configured the door answers `skipped_no_bucket` before any transaction opens,
so the documented dev/test no-op stays a storage no-op that needs no database.

Because the door gates its put, it also hands back the CANONICAL payload with
`already_archived`, not just a descriptor. A caller holding its own fetch of the
same artifact — two runs can fetch independently, and a payload can differ
between fetches — would otherwise stage lake rows derived from its own bytes
while the staging receipt named the archived object they did not come from,
leaving the lake disagreeing with both its receipt and canonical S3. Returning
the verified archived contents makes staging the wrong bytes unrepresentable
rather than merely discouraged, and every caller stages what it is given.

A receipt conflict is still never returned as a commit, and the fence does not
make that redundant: it serializes captures that go through the door, so the
throw remains the answer for any disagreement the lock does not cover.
Reporting a conflict as a commit
would put that receipt's kind in the Workflow's `receiptKinds`, so the run
would claim an attestation it does not hold and then complete, leaving the
drift inside one Activity result no later poll re-examines. It throws
non-retryably instead, because a retry would read the standing receipt and
converge quietly on the other writer's descriptor, burying exactly the signal
worth seeing. A receipt that could not be written at all is the opposite case
and throws retryably.

The capture also mints the prematch delivery intents, and that is likewise
forced rather than chosen. `planPrematchFanOut` READS intents — the frozen
contract's discipline — and receives only a match reference, while the channels
owed an announcement are derived from the tracked accounts in the game, which
only the spectator roster names. The capture is the one Activity holding that
roster. It mints them `pending`; `markNotificationReady` is the notification
Workflow's own phase.

The prematch intent key format lives in `durable/match/delivery-intents.ts`
(`prematchDeliveryKeyPrefix` + `deliveryIntentKey`), so every caller builds it
the same way. Two spellings would mean two rows and one channel told twice. The
write is strict, for the reason the per-match core gives, and it reads before
it writes: `upsertIntent` compares the whole stored row, so a retry on a later
clock would otherwise be answered `intent-differs`.

An `intent-differs` conflict that survives that read is reported rather than
thrown — the opposite call from the receipt conflict above, because the two
mean different things. A receipt mismatch is two producers disagreeing about a
fact, where only one answer can be true. `intent-differs` is two producers
minting the same INSTRUCTION, differing only in the clock each stamped it with;
the stored row is a valid, drivable instruction whoever wrote it. Failing would
turn a benign race into a flapping child. It stays a distinct outcome rather
than folding into "already existed", so a rate that climbs — when the race
should be rare — is visible.

Dedup is the per-game Workflow ID.
`scoutPrematchGameWorkflowId` drops the puuid, so one game surfaced through
every tracked account in it computes one ID, and
`ALLOW_DUPLICATE_FAILED_ONLY` replaces a run that failed while refusing one
that is running or done. Unlike post-match discovery, the poller does not wait
for its children and does not stop at a taken ID: live games have no chronology
to protect, and the Schedule's `SKIP` overlap policy allows one poll at a time,
so waiting would put the next poll behind the slowest game.

## The notification lane

`scoutNotificationWorkflow` drives one `MatchNotificationIntent` through the
frozen domain machine. The Activities live in `src/temporal/notification-lane/`
and `src/temporal/notification/`, and three facts about the lane are
load-bearing for anyone extending it.

The row's `subjectKind` and `subjectId` name the event being announced.
Existing match intents use `match` and the Riot match id; `riotMatchId` remains
indexed for match fan-out. Duel status uses `duel` and the series id, while
Dare notifications use `dare` and the numeric Dare id. Neither has a Riot
match id. During
the schema rollout, a match row with a NULL `subjectId` is read from its
required `riotMatchId` because older application pods still write that shape.
New writers populate both match columns, and the database rejects a mismatch.

Duel challenge, lobby-ready, and overdue transitions mint `duel-status` intents
and request a notification Workflow in the same database transaction as the
series change. Reconciliation starts a requested Workflow after a producer
crash. Its first read Activity records Temporal's run id as acceptance of that
request, so later sweeps stop treating it as an unaccepted start. Repeated
producer transitions reuse the standing intent without opening a new request.
The invite expires at the series deadline; lobby-ready and overdue
messages expire after two hours and seven days respectively. The intent stores the
guild, series, and mention list in a versioned announcement and verifies the
series and target channel before sending. It does not create a match render
receipt for a Duel subject.

Dare lifecycle and progress transitions mint one `dare-status` intent and
Workflow start request per frozen recipient in the same transaction. The
versioned announcement keeps the event category, summary, and guild used by
the legacy DM. Delivery checks the current guild flag and recipient preference
before sending through the audited DM path with mentions suppressed.

A Dare that resolves (achieved, unachieved, or voided with money moved) also
mints one channel-targeted `dare-status` intent for its own channel, keyed
`dare-result:<dareId>:revision:<revision>`, in the settling transaction. Its
announcement carries the payouts and refunds the ledger recorded, so the post
names exactly who was paid or refunded and allowlists only those mentions. It
answers to `dare_notifications_enabled` alone (DM preferences do not apply),
and once Discord accepts it the follow-up edits the Dare callout to its final
state; the pending-callout scan skips a Dare whose post is still owed, so the
channel reads result first. A match owed no public delivery writes neither the
DMs nor the post. The settling transaction stamps the Dare's `settledMatchId`,
which is how a resumed settlement receipt still names a Dare an earlier attempt
resolved. The
intent expires thirty days after the event, and an ambiguous DM failure stays
`unknown-delivery` for operator resolution. The legacy Dare event/delivery
tables continue draining pre-cutover rows; a standing legacy event owns its
deduplication key and prevents the notification lane from announcing the same
event again.

### An intent says what it announces and where it came from

Every intent carries a `kind` (`postmatch` | `prematch` | `settlement` |
`dare-status` | `hall-record-break` | `duel-status`) and an `origin`
(`live`, or `recovery` naming the batch that minted it). Both are fixed at
mint, mirrored into columns, and versioned in the payload envelope
(`notificationIntentCodec` version 3; a version-1 payload derives its kind from
the key prefix the two producers of that version used, and refuses any other
prefix). The kind selects the renderer and the message builder: a `prematch`
intent is rendered from the archived spectator snapshot and delivered as the
game-start message, and nothing on that arm reads a MatchV5 payload — so a
prematch intent re-driven after its game ended can never deliver a post-match
report. A prematch message carries its guild's Bryan Bucks buttons and
live-market line exactly when that guild holds an open pool for the match,
and the post-delivery follow-up records the message on the pool so the close
sweep and the settlement announcement can find it (see
[Prematch delivery and markets](#prematch-delivery-and-markets)).

### The announcement kinds carry their message on the intent

A `settlement` intent is one guild channel's Bryan Bucks recap for one match.
It has no image — its render attests `none` (`text-only`) — and its message is
built at the send from an `announcement` envelope on the intent, parsed by the
codecs in `notification/announcement-codecs.ts`: the settlement summary,
parlay result and this guild's earnings exactly as settlement produced them.
The intent carries those presentation inputs rather than the receipt's
identities on purpose — the receipt names no amounts, and rebuilding pool
totals and payouts from ledger rows would be a second implementation of
settlement arithmetic. The arm composes the shared builder
(`prepareSettlementAnnouncement`) so budgets and mention safety exist once. A
settlement recap replies to the delivered POSTMATCH intent's `messageId` for
the same channel (`failIfNotExists: false`), with one plain send when the
reply itself is refused. It refuses a DM target as terminal: private
settlement receipts would be a separate, budgeted fan-out, and that is an
explicit gap.

A `hall-record-break` intent is one guild's Hall of Fame announcement for one
match, keyed `hall-record-break:<riotMatchId>:<guildId>` — by guild, not
channel, so a Hall channel change never mints a second one. Its envelope is
`{guildId, riotMatchId, records}`, and the arm
(`notification/hall-record-break-notification.ts`) renders one embed for the
records. An envelope whose every record id was since
retired, or that does not parse, is terminal `content-unavailable` rather than
an empty embed. The per-server `hall_of_fame_enabled` policy is re-read before
delivery by `notification/kind-policy.ts`, in `markNotificationReady` and
again in `beginNotificationSend` (after the recovery gate, before the
audience check): a guild that turned the Hall off gets the intent suppressed
`feature-disabled` through the domain's `suppress`, and no attempt is minted.
The delivery Activity checks the flag again immediately before the Discord
request. If it changed after the attempt began, the Activity confirms that no
request left and `confirmUnsentSuppression` records the same terminal reason
against that attempt's nonce. Channel lookup stays with audience retirement
before the attempt; the delivery Activity also verifies that Discord resolved
the target in the envelope's guild and parks a mismatch as terminal
`content-unavailable` without sending.
The delivery counter increments only when the durable `delivered` transition
applies, so retrying its Activity does not count a second send. The best-effort
post-delivery follow-up captures `hall_record_broken` with a stable event ID
derived from the intent key, so retrying that Activity keeps one event identity.

### Delivery sends exactly what the render attested, and establishes nothing

`renderNotificationArtifact` runs on `background` under the effect fence and
is the only place the report generator runs on the notification lane. That matters
beyond the Satori cost: the generator refetches every tracked player's rank and
upserts this match's `MatchRankHistory`, and it spends the one AI review a
match is allowed (`markAiAttempted` is global to the match). Both are facts
about the MATCH, established once — so the render evaluates the review's
per-guild gate against the whole audience the report will reach
(`resolvePostmatchDeliveryChannels`, shared with intent minting) rather than
against one channel's guild.

What the generator built is then committed and attested whole: the report image
and, when the match earned one, the review's image as objects under the report
key layout, plus the content line and which components were attached
(`v2-notification-render` evidence version 2, keyed per `(kind, match)`). A
prematch render attests the loading screen, or `none` for a queue it cannot
draw, which the send answers with the fallback embed; the announcement kinds
attest `none` (`text-only`).

`deliverNotification` runs on `realtime` and only reassembles. It reads the
receipt, fetches the objects it names, verifies each against its digest and
size (`notification/notification-artifact.ts`, one reader per kind), and
rebuilds the message with the shared furniture builders. It runs no generator, no
Riot read and no model call, so a delivery re-driven days later — a
reconciliation sweep after the player's next game — rewrites no history, and
every channel's message carries the same review rather than the first one
consuming it. Two failures on that path are terminal, not retryable: an object
that is missing or hashes differently, and a receipt attesting something its
kind cannot deliver (`MalformedRenderReceiptError`). Both are deterministic
facts about persisted evidence that parse the same way on every read, so both
report `content-unavailable` instead of returning the intent to `ready` for
reconciliation to re-drive forever.

### Only the Discord request may be ambiguous

`deliverNotification` runs with `maximumAttempts: 1`, because a retry can
post a second message, so any failure the Workflow cannot attribute is recorded
as `unknown-delivery` — a dead end only an operator leaves. That is the right
answer for the Discord request and the wrong answer for everything around it,
so two boundaries keep the rest out of it.

Before the send, the Activity works under a pre-send budget
(`notification/pre-send-budget.ts`) that is strictly shorter than its own
heartbeat and start-to-close timeouts, which are stated once in
`activity-contracts.ts` so the two cannot drift. The receipt read, object
fetch, policy gate and guild lookup provably contact nobody, so whatever has
not finished by then is answered by the Activity as a definite, retryable
non-send while it is still alive to answer — rather than by the server's clock,
which reaches the Workflow as a bare timeout indistinguishable from an
unanswered send. The object read takes the budget's `AbortSignal` and is
genuinely cancelled.

After the send, nothing runs in that Activity at all. The Dare callout refresh
is `afterNotificationDelivered`, its own Activity, called by the Workflow
only once the outcome is durably recorded: a best-effort Discord edit that
outlived the heartbeat timeout used to kill the delivery Activity before its
decided `delivered` result could be returned, turning a message Discord had
accepted into an ambiguous send.

Deterministic content violations are terminal rather than retryable, because
the row parses the same way on every read and reconciliation would otherwise
re-drive it every sweep forever. `UndeliverableContentError` is the shared type
the send narrows on: a receipt attesting a shape its kind cannot deliver, a
receipt whose digest and size contradict each other, or an announcement payload
that cannot produce a message. Evidence that is merely unreachable — a timed-out
object store, a database that did not answer — stays retryable, because the next
attempt genuinely may succeed.

### The silent post-match backfill renders and announces nothing

`scoutSilentPostmatchBackfillWorkflow` is an operator tool with no Schedule.
It takes an explicit list of match ids and, for each, runs the same fenced
render a `postmatch` intent's notification child runs, committing the same
report objects and the same `v2-notification-render-postmatch` receipt. It
exists for matches whose core finished without minting their report intents,
which leaves no notification child to render them.

It cannot announce anything. The Workflow proxies one Activity,
`backfillSilentPostmatchArtifact`, and starts no child. The backend Activity
(`notification/silent-postmatch-backfill.ts`) imports neither the minter nor
the delivery code. It reads the pipeline state first and skips the match,
giving the reason, in any of these cases:

- a render receipt already stands;
- the match is not `temporal-v2`-owned;
- the match is `ARCHIVE_ONLY` or was observed `silent-backfill`;
- the core has not attested every phase and advanced every cursor;
- a postmatch intent already stands, so the live lane owns the render;
- no channel is deliverable, so a normal run would have rendered nothing.

It renders in `historical` mode: the generator receives the rank changes that
settlement already recorded for the match and does not re-capture today's rank
over them. It also builds the report without community-MVP vote controls, so no
`MatchMvpContest` is created for a message that will never be posted. It keeps
the AI review. The objects are filed under the game's creation date. Reruns are
idempotent, because a receipt that already stands turns the match into a skip.

```bash
toolkit temporal workflow start --namespace <stage> \
  --task-queue scout-<stage> --type scoutSilentPostmatchBackfillWorkflow \
  --workflow-id scout-<stage>-silent-postmatch-backfill-v2-<label> \
  --input-file <envelope.json>
```

The input is the `scout-silent-postmatch-backfill-v2-input` envelope:
`{"kind":…,"version":1,"data":{"stage":…,"riotMatchIds":[…]}}`, with at most
500 unique ids.

### The recovery policy gates delivery

A recovery batch's `RecoveryPolicy` means something here and nowhere else. The
policy is read off the BATCH row every time an intent is judged — never copied
onto the intent — so `operatorReleasePolicy` on the batch reaches every intent
born of it at their next read. `notificationDeliveryDecision`
(`@scout-for-lol/domain/recovery/delivery-policy.ts`) is the rule: `normal`
permits everything, `stale-private-only` permits DMs only (through `sendDM`'s
own budget), `no-external` permits nothing. A held intent is neither failed nor
suppressed: the Workflow's opening read returns `held` and the run ends `no-op`
with a `disposition` naming the policy and target; `beginNotificationSend`
refuses it with `policy-held` before any nonce is minted; the send itself
refuses too; and the reconciliation sweep's stalled-intent read excludes it in
SQL so it is not re-driven every minute until the batch is released. Nothing
mints recovery-born intents yet — recovery commits `ARCHIVE_ONLY`
observations — so the gate is the contract a later recovery lane delivers into.

### Overdue intents are expired, not left drivable

`beginSend` refuses any start strictly after an intent's `freshnessDeadline`,
so a `pending` or `ready` intent past it can never be sent, and nothing in the
send path moves it. The `notification-intent-expiry` background job — a Scout
Schedule every five minutes on both stages — selects those intents, the most
overdue first and at most 200 a run (`durable/match/intent-expiry.ts`), and
applies the domain's `expire` to each through `transitionIntent`. It never
selects `sending` or `unknown-delivery`: both name an attempt whose outcome is
unknown, and only the unobserved-send recovery or an operator may settle them.
A `beginSend` that commits between the sweep's read and its write makes the
repository's state guard miss, and the re-read answers `send-in-flight`, so the
attempt wins. Each run logs its counts; the result is visible on
`scout_durable_notification_intents{state="expired"}`.

### Intents whose audience was deleted are retired, not re-targeted

An intent names one audience, and when that audience is deleted before
delivery the intent is retired into `suppressed` with a
`NotificationRetirementReason` — `subscription-deleted`, `channel-deleted` or
`guild-left` — through the domain's `retireOrphaned`. It is never re-targeted:
nothing re-derives a channel or subscription for it. `retireOrphaned` moves
only `pending` and `ready`; `sending` and `unknown-delivery` conflict, so a
retirement always loses to a send in flight.

The send path discovers it. `beginNotificationSend`, for an unattempted
intent and before any nonce is minted, first checks a Hall intent against its
guild's installation lifecycle. A removal stamp or an `installedAt` later than
the intent's creation retires it as `guild-left`, including when the bot was
reinstalled and the same channel still exists. A missing lifecycle row alone
is no evidence of removal. The send path then asks Discord for the target channel
(Unknown Channel is `channel-deleted`; a channel whose guild Scout is confirmed
not to be in is `guild-left`) and then, for the subscription-backed kinds
(`postmatch`, `prematch`), whether any subscription in the channel still
follows a tracked account in the match — or, before the match has tracked
accounts, any subscription at all (`subscription-deleted`). In this audience
check an unreachable or refusing Discord is no evidence, and the send proceeds
to its final guard. A guild removal
usually arrives as `subscription-deleted`, because the removal cleanup deletes
the guild's subscriptions and Discord then refuses the channel read. The
retired intent answers the Workflow with its `suppressed` state, which it
already treats as the end of the run, so no Workflow command changed.

A Hall attempt has one more check immediately before the Discord send. The
delivery Activity rereads the lifecycle row and fetches Scout's own guild
membership without the REST member cache. Discord's `joined_at` must be no
later than the intent's creation; a later join suppresses the old installation's
announcement even if the gateway's best-effort lifecycle write failed. If the
join time cannot be confirmed, the Activity returns a retryable pre-send
failure. No Discord message is sent on that attempt.

The `notification-intent-expiry` job also retires, from the database alone,
the fresh `pending`/`ready` subscription-backed intents whose subscriptions are
gone (`durable/match/intent-retirement.ts`), after expiry and at the same
instant, so the two never select one row. Both paths count each applied
retirement on `scout_durable_notification_intents_retired_total{reason,source}`
and log it; the ready-backlog family reads `state = 'ready'` only, so a retired
intent leaves it.

### Hall record breaks are intents

`evaluateHallMatch` announces a guild's record breaks inside its own Hall
transaction through `announceHallRecordBreak`
(`src/progression/hall/break-announcement.ts`), which mints one `pending`
`hall-record-break` intent per (guild, match) with a freshness deadline of
creation plus 24 hours. A standing intent is left as it is; one whose records
differ from this evaluation's throws instead of choosing.

The committed observation decides silence: a `silent-backfill` match updates
its records and announces nothing, and a match with no observation throws,
because an intent without an observed match could never enter the post-commit
fan-out.

Progression runs before the match core's post-commit fan-out, and
`planMatchFanOut` starts a notification child for every drivable non-prematch
intent of the match, so a minted hall intent is driven by the same run with no
extra wiring. An intent the fan-out misses stays `pending` until a
`scoutPipelineReconciliationWorkflow` run drives it.

## Beta Customs operations

Scout Customs reuses this process's Discord gateway client, OAuth client
secret, JWT signing secret, Match-V5 cursor, Scout Client ingress, and S3
ingest boundary. It has no second bot or manual winner endpoint.

Before enabling `custom_nights_enabled`, configure the existing beta Discord
Activity at `/customs/`, grant the beta install Manage Channels and Move
Members, and enable `scout_client_ingestion` for participating users. A player
creates the normal custom lobby in League. A paired client then binds the exact
observed roster to the pending Customs game. Production hard-disables the
Customs flag and its site archive rejects any `/customs/index.html` artifact.

The beta `custom-nights-expiry` Temporal schedule closes unfinished nights
after their 12-hour database deadline, writes an audit event, and releases the
active-night pointer. It does not verify a game or synthesize a Riot result.

The scoped privacy command refuses an active night or pending voice work:

```bash
bun run customs:anonymize -- \
  --guild-id <guild-id> \
  --discord-id <participant-id> \
  --operator-id <operator-id> \
  --confirm yes
```

## Hey Scout voice assistant (beta)

`src/voice-assistant/` binds the shared `@shepherdjerred/voice-assistant`
wake-word pipeline to durable Explore. It transcribes accepted audio, starts a
Voice-surface Explore turn, and synthesizes the saved answer. Explore owns the
League reference, ScoutQL, and on-demand Riot-history tools; Voice owns only
speech transport and session policy. Each speaker gets one private saved
Explore conversation per `/scout join` session. Audio is not persisted.
Sessions end on `/scout leave`, after 45 minutes without an accepted wake,
when the channel holds no non-bot members, or on connection loss.

A turn that takes more than two seconds receives a spoken acknowledgement and
continues durably. Disconnecting stops later speech without cancelling the
saved Explore run. A completed answer permits two same-speaker, wake-free
follow-ups within 15 seconds.

`explore_on_demand_riot_enabled` separately gates the acquisition tool on
every Explore surface. It defaults off; the managed beta rollout enables it
only for the configured Scout test guild while Riot cost and rate impact are
measured.

**Activation is one flag: `voice_assistant_enabled`.** It decides where the
`/scout join`/`leave` subcommands register, whether a join may open a session,
and — rechecked mid-join and swept periodically — whether a live session keeps
running. Production is hard-disabled in code
(`PRODUCTION_HARD_DISABLED_FLAGS`), which unauthenticated Flipt cannot
override.

There is deliberately no second `VOICE_ASSISTANT_ENABLED` env gate. It used to
exist because SHA-pinned model verification was fatal at boot, which a flag
cannot express; the models now load lazily on first `/scout join`
(`voice-assistant/runtime.ts`) and the asset set is proven by the image's
`voice-smoke` build stage instead. A boot-time gate would also have been a poor
flag — it only takes effect on the next restart.

The remaining environment surface is credentials and bootstrap only:
`OPENAI_API_KEY` (direct/local) or `OPENAI_API_KEY_FILE` (mounted Secret),
`VOICE_ASSETS_DIR` (default `/opt/scout/voice`), and `VOICE_KWS_RUNTIME`
(`auto`/`native`/`wasm`). Asset filenames are the manifest
in `src/voice-assistant/constants.ts`.

Loading is reported, never fatal: a missing credential answers "not configured
in this deployment", and a failed model load answers "could not start" and is
logged — the two are distinct so a broken asset set is never reported as a
benign one. A pod that cannot load voice still serves everything else.

The models are baked into every image at `/opt/scout/voice` by the Dockerfile's
`voice-models` stage, whose downloads are SHA-256 pinned, and a `voice-smoke`
stage loads them as the deploy uid under both keyword runtimes before the image
can be published. Baking unconditionally keeps the published digest identical
in every environment, so enabling voice is a flag flip rather than a redeploy.

The guild `/scout` command is a per-guild merge: `ask` follows the Explore
allowlist, `join`/`leave` follow the voice flag
(`discord/commands/definitions.ts`). `VoiceManager` connections carry a mode:
assistant sessions are undeafened and are never displaced by sound-engine
alerts (alerts duck under assistant speech instead).

Manual end-to-end probe (macOS, trained assets + `OPENAI_API_KEY` required, no
Discord): `bun scripts/smoke/voice-probe.ts --list-devices`, then
`bun scripts/smoke/voice-probe.ts --device <index> --assets-dir <path>`.

## How web requests read Discord

No HTTP, tRPC, or Discord Activity request reads the gateway client's guild
cache. That cache cannot answer honestly on a request path — an unconnected or
still-backfilling client looks exactly like "Scout is not installed there" —
so web-serving code goes through two application ports instead, and a pod that
never connects a gateway serves the same answers as one that did:

- `lib/discord/installed-guilds.ts` answers "is Scout installed here?" from
  `GuildInstall` rows with `removedAt: null`. This makes `GuildInstall` an
  authorization source, not just an analytics table: its writers
  (`discord/events/guild-create.ts`, `guild-delete.ts`,
  `analytics/guild-lifecycle.ts`) are load-bearing for access control. Because a
  missing row is not proof of absence, a negative from the table is confirmed
  against Discord before it is believed.
- `lib/discord/bot-rest.ts` performs the authoritative bot-token REST reads the
  web needs — guild channels, roles, a single member, member search, user
  profiles — behind bounded per-guild TTL caches. Channel permission filtering
  is recomputed from roles and overwrites in `lib/discord/channel-permissions.ts`
  rather than read from a cached `GuildMember`.

Three outcomes stay distinct on every path: Discord unreachable
(`SERVICE_UNAVAILABLE`, or 503 on the Activity surface), Scout not installed
(`NOT_FOUND` / 403), and the caller not authorized (`FORBIDDEN`). Failing to
reach Discord must never be reported as either of the other two;
`trpc/discord-upstream.ts` and `customs/activity-auth.ts` enforce that.

Parallel web procedures share one in-flight guild membership read per user
before its five-minute success cache is populated. Failures remain errors and
are not cached as empty guild lists. Re-authentication invalidates both the
cached result and the old in-flight read's ability to repopulate it.

Gateway events still _write_ installation state. Two background paths that used
to _read_ the gateway cache now use the same install port, because they run as
Temporal Activities that a split deployment executes with no shard at all:
weekly leaderboard delivery (`betting/weekly/weekly-leaderboard.ts`) and
scheduled report dispatch (`reports/discord-dispatcher.ts`). The consumer and
Explore eligibility check (`consumer/access.ts`) uses it too.

One gateway-cache read is deliberately left: `discord/utils/guild-membership.ts`
`getActiveServerIds()`, which narrows player polling to live guilds. It fails
open (an absent cache means "no filter", so polling widens rather than skipping
work), and the `GuildInstall` table cannot safely replace it — that table is
documented as possibly missing rows for Scout's earliest guilds, and filtering
by an incomplete set would stop polling those guilds entirely.

## How Scout posts to Discord

Delivering is REST — `POST`/`PATCH`/`DELETE` on a channel id — but _resolving_
the channel is where the gateway sneaks back in. `client.channels.fetch(id)`
makes the REST call either way and then builds the channel by looking its guild
up in the gateway's guild cache, and at the default `allowUnknownGuild: false`
it returns `null` when the guild is not cached. On a role with no shard that
cache is permanently empty, so every live channel would come back
indistinguishable from a deleted one: scheduled reports and the weekly
leaderboard would deliver nothing and report success, and the owner would be
DMed that a channel they still have was deleted.

So every delivery resolves its channel through
`discord/utils/channel.ts#fetchChannelForDelivery`, never `client.channels.fetch`
directly. Two rules come with it:

- The channel it returns on a gatewayless role has **no `guild`**, and discord.js
  permission helpers (`permissionsFor`, `ThreadChannel.parent`) throw on it
  rather than denying. Ask `permissions.ts#hasResolvedGuild` first.
  `checkSendMessagePermission` reports `unknown` there, which is deliberately
  not `denied`: a denial is escalated to the guild owner as a permission they
  revoked. Real revocations still escalate — Discord labels them 50013/50001 on
  the send itself, which is classified without any local permission state.
- The exception is voice. `voice/voice-manager.ts` needs
  `channel.guild.voiceAdapterCreator`, so it keeps the guild-bound fetch; the
  capability table already restricts voice to roles that own a shard.

## Runtime roles

The image boots into one of four shapes, selected by `SCOUT_RUNTIME_ROLE`. The
vocabulary and the exact subsystem set per role are one table in
`configuration/runtime-role.ts`; `runtime/plan.ts` derives the boot and
shutdown order from it, and `runtime/subsystems.ts` performs the steps. Unset
means `combined` in development and is refused in beta and production;
`combined` itself is refused outside development, and an unrecognised value
always throws at startup rather than falling back.

| Subsystem                           | `combined`                                        | `application`               | `gateway`          | `activity-worker`    |
| ----------------------------------- | ------------------------------------------------- | --------------------------- | ------------------ | -------------------- |
| Champion assets                     | yes                                               | yes                         | yes                | yes                  |
| Voice assistant and Discord gateway | yes                                               | —                           | yes                | —                    |
| Report-lake access                  | read + write                                      | read + write                | read-only          | read + staging write |
| Report-lake fold / publish          | yes                                               | yes                         | —                  | —                    |
| Temporal workers                    | workflow, interactive, lake, realtime, background | workflow, interactive, lake | none (client only) | realtime, background |
| Discord REST                        | yes                                               | yes                         | yes                | yes                  |
| HTTP surface                        | full                                              | full                        | health + metrics   | health + metrics     |
| Competition activity worker         | yes                                               | —                           | —                  | yes                  |
| Database metric sweeps and seeding  | yes                                               | yes                         | —                  | —                    |

Notes that are easy to get wrong:

- **`combined` is the development role.** It is everything in one process:
  local development runs it whenever it owns the Discord gateway, and runs
  `application` otherwise. Hosted stages always run the three split roles.
- **Voice is gateway-coupled by design.** It reads an active voice connection's
  audio, so it cannot be moved off the shard. That makes `gateway` an explicitly
  stateful role.
- **Discord authoring uses persisted Explore runs.** `/scout ask` and Dare
  authoring reserve the shared durable quota and hand off to the interactive
  Activity queue through `explore/runs/discord/turn.ts`. The gateway waits for
  the exact saved result; an ambiguous start remains pending for reconciliation.
  Beta gateway declares no lake access. Dev and production retain their
  compatibility capability until their topology migration. Every lake reader
  asserts its capability in `reports/duckdb/lake.ts`.
- **`application` publishes the report lake**, and owns the collectors that
  sweep the database on every `/metrics` scrape. Every role serves `/metrics`,
  but running those four collectors on all of them would turn one Prometheus
  scrape interval into N full sweeps of the same tables.
- **Reading the lake is wider than publishing it.** Every embedded Temporal activity
  queue reads the lake somewhere: `realtime` settles SQL dares and evaluates
  hall progression, `interactive` answers Explore queries, `background` runs
  reports, parlay generation and the summoner-index
  backfill, and `lake` is the compactor. Several of them also write its staging
  directories. `activity-worker` mounts the same ZFS claim as the application
  with write access, on the same node and SELinux level. The volume must have
  `ZFSVolume.spec.shared=yes`; generation bundles keep independent staging
  writes separate from the application's fold and publish operation.
- **Hosted activity ownership is fixed.** Both stages run `application`, a
  separate gateway, and an activity worker. The worker owns realtime,
  background, and competition Activities. The application owns interactive and
  lake Activities; production retains its embedded Workflow poller. Beta's
  dedicated Workflow Deployment owns Workflow routing. Rollback uses an
  accepted image with the same split roles.
- **A lake-reading role that does not publish verifies instead.** An empty or
  unmounted lake is not an error for DuckDB — it scans zero parquet files and
  returns zero rows — so a worker would record every report run and dare
  settlement as a _successful_ run that found nothing. Roles with
  `reportLakeAccess` and no fold assert a published build at boot and refuse to
  start without one.
- **`application` does not wait for a shard.** The old Discord-before-HTTP
  ordering existed because web code read the guild cache; it goes through the
  ports above now, and this role has no gateway to wait for.
- **A gatewayless role marks its gateway `disabled` at boot.** The health
  singleton starts at `connecting`, and `/livez` fails a pod whose shard never
  acknowledged a heartbeat once the five-minute startup grace period ends — so
  skipping the login without saying so is a crash loop, not a missing feature.
- **`gateway` runs a Temporal client with no workers.** Commands start Workflows
  they do not execute.
- **Recovered Explore activities register with the application run manager.**
  A voice or Discord turn starts on the gateway but executes on the
  `interactive` worker; rehydrating it there holds the same per-conversation
  lock used by web starts, so the two surfaces cannot advance one transcript
  concurrently. Once the durable row becomes terminal, the gateway releases
  its non-executing copy and local rate-limit ticket.
- **`scout_temporal_workers`** reports the embedded queue classes, including
  zero for classes a role does not run. `ScoutTemporalWorkerMissing` compares
  fresh same-pod scrapes against declared hosted owners. Beta Workflow health
  instead matches fresh normal SDK pollers to the current and nonzero ramp
  Worker Deployment builds. The application reads routing at metrics scrape
  time through a bounded Temporal call; unavailable evidence raises
  `ScoutTemporalWorkflowRoutingUnknown`.
- **Every metric carries a `role` label**, set as a registry default from this
  role's name. An alert reading a gauge only some roles produce must scope to
  those roles or it fires on a correct deployment; `ScoutDiscordDisconnected` is
  the worked example, and it scopes per stage because the gateway owner differs
  by stage.
- The externally deployed stable/candidate Workflow Workers
  (`temporal/workflow-worker.ts`) are unaffected by any of this.

## Database preparation and startup

Ordinary image startup runs Prisma migrations, verifies the Bucks ledger using
Postgres only, then boots the selected role:

```bash
bun x --no-install prisma migrate deploy
bun run scripts/check-database-readiness.ts
```

A fresh database needs nothing else: once its migrations are applied it boots
with no import step. A restored database boots the same way. The readiness
check refuses only ledger drift (a `BucksAccount` balance that disagrees with
its ledger sum). Local fixture databases use their existing bootstrap path
rather than this hosted-image entrypoint.

### Local PostgreSQL

Development and tests use the PostgreSQL 18 binaries selected by the root Mise
configuration. The harness initializes a checksummed cluster under
`$XDG_DATA_HOME/scout-for-lol/postgres/18/pgdata`, or
`$HOME/.local/share/scout-for-lol/postgres/18/pgdata` when XDG is unset.
Root-hosted CI uses `/tmp/scout-for-lol/postgres/18/pgdata`.

The harness reuses a server only when its major version and data directory
match. An older server on port 5471 causes an explicit error; its files and
process remain untouched. Choose an unused port while keeping that server:

```bash
SCOUT_PG_PORT=5483 bun run test
```

Turbo passes and hashes `SCOUT_PG_PORT` for both `test` and `test:ci`. Moving
existing development data to a new major requires an explicit dump/restore;
starting the harness does not migrate a previous cluster.

## Configuration

Environment variables are validated with `env-var`/Zod at startup. Discord and
Riot API tokens are required; in test mode (`NODE_ENV=test`) placeholder values
are used automatically. For a full local backend + web app, use
`bun run dev:web` from the Scout package root (secrets via 1Password). Local
`dev:web` does not own the BETA Discord gateway unless you pass
`--discord-gateway`: without it the backend runs the `application` role.
`--no-background-jobs` now sets only `SCOUT_DEV_SKIP_REPORT_LAKE_FOLD`, a
dev-only switch for the one boot step a laptop with no published lake build and
no S3 bucket cannot complete; it is rejected outside `ENVIRONMENT=dev`.

That flag skips the fold and nothing else. The separate check that the lake
holds a published build still runs while it is set, downgraded from a refusal
to a warning: a lake-reading pod pointed at an empty directory does not fail —
DuckDB scans zero files and the run is recorded as a success — so the one thing
this check must never be is silent. Outside dev it always refuses. See
`src/runtime/report-lake-gate.ts`.

See the [report-lake explanation](../../../docs/wiki/src/content/docs/explanation/scout-report-lake.md)
and the parent [README](../../README.md) for architecture. The parent
[AGENTS.md](../../AGENTS.md) contains only always-on product and delivery
constraints.
