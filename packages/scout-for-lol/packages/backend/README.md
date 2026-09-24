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

### Durable Temporal work

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
  --reason "OpenRouter capacity restored and this match was reviewed"
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
  the core prompt for every turn where the skill is enabled. Skill body text
  deliberately never enters persisted traces: `tool-inspection.ts` has no
  `load_skill` branch, so share-link holders see only the tool name.

## Durable match facts

`src/durable/match/` holds the typed services the per-match pipeline calls.
Each one runs an injected v1 operation — archive, settlement, progression,
delivery, workflow start — and then records what that operation did in the
durable tables (`MatchObservation`, `MatchTrackedAccount`,
`MatchProcessingReceipt`, `MatchNotificationIntent`, `ScoutWorkflowStart`).

The pipeline remains authoritative for behaviour. Every durable write is
fail-open: it can never throw into the pipeline, so a recorder outage cannot
stall ingestion or suppress a report. `ScoutEffectClaim` is still the
at-most-once Discord delivery guard; a notification intent is a record of what
that guard let through, keyed by the same string so the two describe the same
send.

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
`report-store/store.ts` runs live ingest through the receipted doors and passes
the descriptor back up through `recordMatchForReportStore` to
`requestMatchArchive`, so the stored key and digest are what the put actually
wrote rather than a key rebuilt from the layout convention. They stay NULL when
no object was written (no bucket configured) or when an earlier run had already
archived the match, which is exactly what NULL means there.

Two metrics carry the parity signal, both defined once in
`src/metrics/durable.ts` — prom-client throws at import time on a duplicate
metric name, so a second definition site takes the process down on boot rather
than at the first `inc()`:

- `scout_durable_dualwrite_records_total{write_kind, outcome}` — facts
  recorded, by repository answer (`applied`, `already-applied`, `adopted`,
  `conflict`).
- `scout_durable_dualwrite_failures_total{write_kind}` — writes that failed and
  were swallowed. Non-zero means the durable record is behind what the pipeline
  actually did. These failures deliberately do not reach Sentry: an outage
  would raise one event per write per channel per match and bury the errors
  that actually stop work.

Both are per-write counters incremented by whichever runtime role executed the
write, so a parity dashboard joins across roles rather than reading one
process. Neither is derived from a database sweep, so neither belongs in
`getMetrics()`'s `databaseMetricSweepsEnabled()` block.

`write_kind` comes from the single closed set in
`src/durable/match/durable-facts.ts`, which covers the receipted lake
projection's kinds as well as the per-match services'; a new dual-write site
adds a member there rather than passing a free-form string. `outcome` is parsed
from the repository's own answer before it becomes a label. The two fail-open
wrappers — `recordDurableWrite` and `recordReceiptFailOpen` — refuse to nest,
because both count a completed write and nesting them would report one fact
twice.

## Durable pipeline observability

The dual-write counters above say what the pipeline _did_. Five more families in
`src/metrics/durable-pipeline.ts` — likewise a single definition site — say what
it is still _holding_, which is the half the V2 acceptance checklist asks about:

- `scout_durable_notification_intents{state}` — intents per state of the domain
  machine, zero-filled across all nine. `state="unknown-delivery"` is the
  operator dead end and the unknown-delivery count in its own right.
- `scout_durable_recovery_batches{state}` — batches per state, zero-filled
  across all six.
- `scout_durable_backlog_oldest_age_seconds{family}` — age of the oldest row in
  `stalled-match-processing`, `live-recovery-batches`, and
  `unaccepted-workflow-starts`. Only backlogs whose ordering column is a true
  age are here; stalled notifications sort by freshness deadline, so their head
  is the intent closest to expiring rather than the one waiting longest, and
  their depth lives on the intent gauge instead.
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

The first four are swept from the database at scrape time and so belong to the
one role with `databaseMetricSweeps` (see the runtime roles section). The lake
lag is swept by `report-lake/` instead, because its receipt-kind vocabulary
lives there and `architecture.config.ts` forbids `metrics/` from importing that
layer; it registers through `metrics/sweep-registry.ts`, which exists for
exactly that inversion. `metrics/sweeps.ts` is the list of everything a
sweep-owning scrape runs.

Every metric also carries a `role` default label, from the runtime-role enum.
That is what lets an alert say which pods it is asking about — most sharply for
`discord_connection_status`, which a gateway-less pod reports as a truthful 0,
so an unscoped `min by (environment)` reads a correct deployment as an outage.

## The V2 per-match core

`src/temporal/v2/` holds the nine Activities `scoutMatchProcessingV2Workflow`
calls. They are thin orchestration over the same services the v1 pipeline uses
— the receipted archive door, the Bucks settlement hook, the challenge advisory
lock, the durable repositories — with one deliberate inversion: **V2's durable
writes are strict, not fail-open.**

That is not a disagreement with the section above, it is the consequence of who
depends on the record. A v1 dual-write is a parity record beside an
authoritative pipeline, so a recorder outage must never stall ingestion. In V2
the durable record IS the pipeline's memory: a resumed Workflow decides which
phases already happened by reading it back. A write that quietly failed there
would send the next run to re-apply an effect it cannot see. So the V2
Activities go to the repositories directly and report the repository's own
answer, and an unwritable record fails the Activity for Temporal to retry.

Two vocabularies live alongside each other for the same reason. The
evidence-bearing receipts (`settlement`, `progression`, `raw-archive-match`)
say WHAT happened and are written by the phase that has the evidence. The V2
stage receipts (`v2-match-*`, declared in `@scout-for-lol/temporal`'s
`match-receipts-v2.ts`) say WHICH PHASE this owner completed, carry evidence
derived from the match reference alone, and are what the resume point reads.
A resumed run cannot reconstruct settled bet ids, so it could never re-assert
an evidence-bearing receipt without either inventing evidence or recording a
conflict against the first writer's.

A contested stage receipt is made durable before it fails anything. The
Workflow fails the run that meets one, but a failed execution is not durable:
under `ALLOW_DUPLICATE_FAILED_ONLY` the next discovery starts a fresh execution
whose resume read sees the standing kind without the outcome that contested
it, and would skip the phase and advance the cursor over the same drift one
poll later. So `recordMatchReceiptsV2` records `v2-match-stage-conflict` — the
same shape as the recovery tail's `v2-recovery-conflict`, evidence naming the
match alone — and every later execution refuses at its resume point until an
operator has looked and removed the marker. The reconciliation sweep leaves
such a match alone (it would start a failing child per tick); the operator
listing and the backlog gauge still show it, because it is exactly what a
person needs to see.

Ownership, not the effect claims, is what keeps the two pipelines off one
match. `commitMatchObservationV2` claims `temporal-v2`; a match v1 already owns
answers `ownership-held-by-another-owner`, and the Workflow reports the stored
owner and stops before settlement rather than re-applying v1's effects. The V2
guards are separate keys from v1's precisely so a shared key can never make one
pipeline's completion suppress the other's work.

Two places where the core and v1 were compared and a decision recorded. v1
refuses a match whose discovering account is no longer tracked; V2's platform
check is weaker, not equivalent, so that precondition is restored — discovery
carries the source account into the per-match input and
`commitMatchObservationV2` fails non-retryably before any effect unless it is
still tracked and in the match. A run started without a source, which is what
a reconciliation restart is, resumes an observation that already passed it.
And v1 advances the account cursor inside its progression lock while V2 keeps
it as the last Activity, after the stage receipts; that is a ruling, not an
omission, and `match-v2.ts` records the three facts behind it.

### The post-match poll is owned for a whole V2 run

`BotState.pollStatus` is one row two pipelines write, and it says whether a
post-match poll is in flight. For v1 that question spans one Activity —
discovery and the maintenance that closes the poll are the same call — so v1
opens the poll unconditionally and guards itself with a worker-local flag and
its Schedule's overlap policy. That is unchanged, deliberately: a durable claim
v1 could not release would refuse the next Schedule tick after a worker died
mid-pass, where today it simply runs again.

A V2 poll spans a WORKFLOW: discovery, every match child it awaits in turn, and
the maintenance that closes the poll at the end. A worker-local flag cannot
span that, because it is released the moment the discovery Activity returns. A
second discovery starting in that window — an operator's, against a scheduled
run still working through its children — was therefore not told a poll was
running; it opened one of its own, and the first run's maintenance then marked
that NEWER poll complete underneath it, flipping the status while a live poll
was still running and freeing a third run to start on top of it.

So V2's discovery takes a DURABLE claim (`claimPostMatchPoll`), and the claim's
identity — the instant it was claimed at — rides the scan result through the
Workflow to the maintenance call, which closes only the poll that identity
names. An overlapping discovery is told the poll is held and reports `skipped`,
which the Workflow already treats as "opened nothing, so close nothing". A run
whose claim was taken over closes nothing and fails the Activity
non-retryably, because the poll it meant to close is someone else's and the
identity cannot come back. Takeover needs the claim to have stood past a
30-minute bound, which only a TERMINATED run can do: a worker that dies is
replaced from history, its children keep running, and its maintenance still
releases the claim. `post-match-poll-ownership.integration.test.ts` proves the
claim and the guarded close against a real Postgres; `match-v2.test.ts` proves
the overlap end to end, with the second discovery starting while the first is
awaiting a child.

### Which pipeline owns post-match discovery

The `postmatch-discovery` Schedule always starts
`scoutPostMatchDiscoveryV2Workflow`. That Workflow's first Activity,
`resolvePostMatchDiscoveryOwnerV2` (`src/temporal/v2/postmatch-ownership.ts`),
reads the `scout_v2_postmatch_ownership_enabled` Flipt flag for the stage. The
flag is on by default, and V2 then discovers as described above. When an
operator turns it off, the run starts v1's `scoutPostMatchDiscoveryWorkflow`
as a child and returns its outcome. Turning the flag back on returns the next
pass to V2, and no deploy is needed in either direction.

Only one pipeline discovers at a time. The Schedule's SKIP overlap keeps a run
from starting until the previous one, V2 or delegated v1, has closed, and a V2
run stays open until every match it handed to the dispatcher is acknowledged.
v1 opens its poll without claiming it, so the handoff defers (`defer-v1`, a
`no-op` result) while any live poll still holds `BotState`, and it only starts
v1 once nothing does. In the other direction, V2's claim already refuses a
poll v1 opened. Match children V2 started keep running under `ABANDON`, and
their observation owner still decides who applies each match. The gate is
behind the `scout-v2-postmatch-ownership` patch, so a discovery recorded
before it replays straight into V2 discovery.

`ScoutEffectClaim` keeps taking the top-level Prisma client, and
`src/temporal/effect-claims.ts` carries the reason: `claimScoutEffect` is an
insert that expects to fail and then READS the existing row back, and in
Postgres a constraint violation aborts the surrounding transaction, so the
read-back could not run inside one. The guard and the fact are therefore two
commits by construction, which is why every V2 guarded-effect result reports
them as separate outcomes and names the reconcile.

## The V2 prematch path

The `prematch-*` modules beside them serve `scoutPrematchDiscoveryV2Workflow`
and `scoutPrematchGameV2Workflow`, and they are shaped differently from the
per-match core on purpose.

There is no resume-point read, because there is nothing for one to answer: the
pipeline-state aggregate hangs off `MatchObservation`, and a live game has not
been observed yet by definition. The per-game Workflow has one phase instead of
four, so its replay gate is the receipts themselves — the archive's inside the
door (below), the lake projection's inside `archivePrematchSnapshotV2`. There
are also no V2 stage receipts here: those exist so a resumed run can gate a
phase whose evidence it cannot reconstruct, and the two evidence-bearing
receipts this path writes already answer exactly the question it asks.

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
a timer and fatal for one whose conclusion is durable. The V2 capture throws on
`unavailable` and lets the Activity retry be its wait loop; v1's pollers still
treat it as a skipped tick, which is stated explicitly at each call site rather
than inherited from a value that could not tell the difference.

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
`stageLakeProjectionV2`, which is the one place this path diverges from the
per-match core's separation of archive from projection. It has nowhere to defer
to: `scoutLakeProjectionV2Workflow` is keyed by a match id and projects the
MatchV5 payload, which does not exist while the game is still being played.

### The archive door is fenced, for every artifact family

All three archive doors — match, timeline and prematch — take an advisory lock,
because all three share one hazard. Each family's S3 key is deterministic, one
per (match, kind), but the BYTES under it are not guaranteed identical across
two fetches. A prematch payload varies by construction, since `gameLength`
advances between polls. A MatchV5 response is semantically stable once the game
is over, but stability of meaning is not identity of bytes: serialization order
and late corrections both produce a different body for the same match, and the
v1-vs-V2 dual-run window archives one match from two independent fetches.

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
pipelines enter through it — v1's ingest paths and the V2 Activities — and a
fence at one call site would serialize that caller against itself while leaving
the cross-pipeline race open.

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
derivation point. This mirrors the 600/900 split `temporal/v2/effect-fence.ts`
documents for the same hazard.

Two contracts the fence must not change. The RECEIPT is fail-open and the put's
exclusivity is not: a receipt write that aborts the fencing transaction after
the canonical put landed is reported as `archived` with `receipt: "failed"` —
the object is in S3, the record of it is not, which is what that answer has
always meant — so a bookkeeping outage cannot turn v1's live ingest into a
failure, while a failure before the put still propagates. And with no bucket
configured the door answers `skipped_no_bucket` before any transaction opens,
so the documented dev/test no-op stays a storage no-op that needs no database.

Because the door gates its put, it also hands back the CANONICAL payload with
`already_archived`, not just a descriptor. A caller holding its own fetch of the
same artifact — the two pipelines poll independently, and a payload can differ
between polls — would otherwise stage lake rows derived from its own bytes
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
forced rather than chosen. `planPrematchFanOutV2` READS intents — the frozen
contract's discipline — and receives only a match reference, while the channels
owed an announcement are derived from the tracked accounts in the game, which
only the spectator roster names. The capture is the one Activity holding that
roster. It mints them `pending`; `markNotificationReadyV2` is the notification
Workflow's own phase.

Both pipelines mint against the same channel while the rollout runs, so the
prematch intent key format lives in `durable/match/delivery-intents.ts`
(`prematchDeliveryKeyPrefix` + `deliveryIntentKey`) and both callers build it
there. Two spellings would mean two rows and one channel told twice. The V2
write is strict where v1's recorder is fail-open, for the reason the section
above gives, and it reads before it writes: `upsertIntent` compares the whole
stored row, so a retry on a later clock would otherwise be answered
`intent-differs`.

An `intent-differs` conflict that survives that read is reported rather than
thrown — the opposite call from the receipt conflict above, because the two
mean different things. A receipt mismatch is two producers disagreeing about a
fact, where only one answer can be true. `intent-differs` is two producers
minting the same INSTRUCTION during the window where both pipelines are live,
differing only in the clock each stamped it with; the stored row is a valid,
drivable instruction whoever wrote it. Failing would turn a benign dual-run
race into a flapping child. It stays a distinct outcome rather than folding
into "already existed", so a rate that climbs after v1 is retired — when the
race should be impossible — is visible.

Dedup is the per-game Workflow ID rather than the `ActiveGame` row.
`scoutPrematchGameV2WorkflowId` drops the puuid, so one game surfaced through
every tracked account in it computes one ID, and
`ALLOW_DUPLICATE_FAILED_ONLY` replaces a run that failed while refusing one
that is running or done. Unlike post-match discovery, the poller does not wait
for its children and does not stop at a taken ID: live games have no chronology
to protect, and the discovery Workflow ID is a per-stage singleton, so waiting
would put the next poll behind the slowest game.

## The V2 notification lane

`scoutNotificationV2Workflow` drives one `MatchNotificationIntent` through the
frozen domain machine. The Activities live in `src/temporal/v2/notification-*`
and `src/temporal/v2/notification/`, and three facts about the lane are
load-bearing for anyone extending it.

### An intent says what it announces and where it came from

Every intent carries a `kind` (`postmatch` | `prematch` | `settlement` |
`dare-summary`) and an `origin`
(`live`, or `recovery` naming the batch that minted it). Both are fixed at
mint, mirrored into columns, and versioned in the payload envelope
(`notificationIntentCodec` version 2; a version-1 payload derives its kind from
the key prefix the two producers of that version used, and refuses any other
prefix). The kind selects the renderer and the message builder: a `prematch`
intent is rendered from the archived spectator snapshot and delivered as v1's
game-start message, and nothing on that arm reads a MatchV5 payload — so a
prematch intent re-driven after its game ended can never deliver a post-match
report. The V2 prematch send carries no Bryan Bucks markets or buttons; v1
opens pools during its send and records message references afterwards, and
buttons on a message nothing recorded would be a market the bot could not
later close. That is an explicit gap, not a silent one.

### The announcement kinds carry their message on the intent

A `settlement` intent is one guild channel's Bryan Bucks recap for one match
and a `dare-summary` intent is one Dare's resolution. Neither has an image —
their render attests `none` (`text-only`) — and their message is built at the
send from an `announcement` envelope on the intent, parsed by the codecs in
`notification/announcement-codecs.ts`: the settlement summary, parlay result
and this guild's earnings exactly as settlement produced them, or v1's
`DareSettlementSummary`. The intent carries those presentation inputs rather
than the receipt's identities on purpose — the receipt names no amounts, and
rebuilding pool totals and payouts from ledger rows would be a second
implementation of settlement arithmetic. The arms compose v1's own builders
(`prepareSettlementAnnouncement`, `dareResultMessage`) so budgets and mention
safety exist once. A settlement recap replies to the delivered POSTMATCH
intent's `messageId` for the same channel (`failIfNotExists: false`), with
one plain send when the reply itself is refused; a delivered Dare result is
followed by v1's best-effort callout refresh. Both kinds refuse a DM target as
terminal: v1's private settlement receipts are a separate, budgeted fan-out
that is not ported, and is an explicit gap.

### Delivery sends exactly what the render attested, and establishes nothing

`renderNotificationArtifactV2` runs on `background` under the effect fence and
is the only place v1's report generator runs on the V2 lane. That matters
beyond the Satori cost: the generator refetches every tracked player's rank and
upserts this match's `MatchRankHistory`, and it spends the one AI review a
match is allowed (`markAiAttempted` is global to the match). Both are facts
about the MATCH, established once — so the render evaluates the review's
per-guild gate against the whole audience the report will reach
(`resolvePostmatchDeliveryChannels`, shared with v1's own delivery) rather than
against one channel's guild.

What the generator built is then committed and attested whole: the report image
and, when the match earned one, the review's image as objects under v1's key
layout, plus the content line and which components were attached
(`v2-notification-render` evidence version 2, keyed per `(kind, match)`). A
prematch render attests the loading screen, or `none` for a queue it cannot
draw, which the send answers with v1's fallback embed; the announcement kinds
attest `none` (`text-only`).

`deliverNotificationV2` runs on `realtime` and only reassembles. It reads the
receipt, fetches the objects it names, verifies each against its digest and
size (`notification/notification-artifact.ts`, one reader per kind), and
rebuilds the message with v1's own furniture builders. It runs no generator, no
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

`deliverNotificationV2` runs with `maximumAttempts: 1`, because a retry can
post a second message, so any failure the Workflow cannot attribute is recorded
as `unknown-delivery` — a dead end only an operator leaves. That is the right
answer for the Discord request and the wrong answer for everything around it,
so two boundaries keep the rest out of it.

Before the send, the Activity works under a pre-send budget
(`notification/pre-send-budget.ts`) that is strictly shorter than its own
heartbeat and start-to-close timeouts, which are stated once in
`activity-contracts-v2.ts` so the two cannot drift. The receipt read, object
fetch, policy gate and guild lookup provably contact nobody, so whatever has
not finished by then is answered by the Activity as a definite, retryable
non-send while it is still alive to answer — rather than by the server's clock,
which reaches the Workflow as a bare timeout indistinguishable from an
unanswered send. The object read takes the budget's `AbortSignal` and is
genuinely cancelled.

After the send, nothing runs in that Activity at all. The Dare callout refresh
is `afterNotificationDeliveredV2`, its own Activity, called by the Workflow
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

### The recovery policy gates delivery

A recovery batch's `RecoveryPolicy` means something here and nowhere else. The
policy is read off the BATCH row every time an intent is judged — never copied
onto the intent — so `operatorReleasePolicy` on the batch reaches every intent
born of it at their next read. `notificationDeliveryDecision`
(`@scout-for-lol/domain/recovery/delivery-policy.ts`) is the rule: `normal`
permits everything, `stale-private-only` permits DMs only (through `sendDM`'s
own budget), `no-external` permits nothing. A held intent is neither failed nor
suppressed: the Workflow's opening read returns `held` and the run ends `no-op`
with a `disposition` naming the policy and target; `beginNotificationSendV2`
refuses it with `policy-held` before any nonce is minted; the send itself
refuses too; and the reconciliation sweep's stalled-intent read excludes it in
SQL so it is not re-driven every minute until the batch is released. Nothing
mints recovery-born intents yet — recovery commits `ARCHIVE_ONLY`
observations — so the gate is the contract a later recovery lane delivers into.

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

The image boots into one of four shapes, selected by `SCOUT_RUNTIME_ROLE`
(default `combined`). The vocabulary and the exact subsystem set per role are
one table in `configuration/runtime-role.ts`; `runtime/plan.ts` derives the boot
and shutdown order from it, and `runtime/subsystems.ts` performs the steps. An
unrecognised value throws at startup rather than falling back.

| Subsystem                                        | `combined`                                                                     | `application`                                               | `gateway`          | `activity-worker`    |
| ------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------ | -------------------- |
| Champion asset verification                      | yes                                                                            | yes                                                         | yes                | yes                  |
| Voice assistant (Hey Scout)                      | yes                                                                            | —                                                           | yes                | —                    |
| Report lake mounted (reads + staging writes)     | yes                                                                            | yes                                                         | yes                | yes                  |
| Report-lake fold / publish at boot               | yes                                                                            | yes                                                         | —                  | —                    |
| Temporal workers                                 | workflow, interactive, lake (+ realtime, background once the gateway is ready) | workflow, interactive, lake, realtime, background (interim) | none (client only) | realtime, background |
| Discord gateway login, commands, guild lifecycle | yes                                                                            | —                                                           | yes                | —                    |
| Discord REST                                     | yes                                                                            | yes                                                         | yes                | yes                  |
| HTTP surface                                     | full                                                                           | full                                                        | health + metrics   | health + metrics     |
| Competition activity worker                      | yes                                                                            | yes (interim)                                               | —                  | yes                  |
| Database-sweeping metric collectors              | yes                                                                            | yes                                                         | —                  | —                    |
| Season / freshness-gauge seeding                 | yes                                                                            | yes                                                         | —                  | —                    |

Notes that are easy to get wrong:

- **`combined` is what Kubernetes runs.** The other three exist so the
  deployment can be split; splitting it is a separate change. `combined` boots
  and drains in exactly the order it always has, and the role tests assert that.
- **Voice is gateway-coupled by design.** It reads an active voice connection's
  audio, so it cannot be moved off the shard. That makes `gateway` an explicitly
  stateful role.
- **`gateway` needs the lake even though it runs no Temporal worker.** `/scout
ask` and the Dare commands execute the Explore agent in the process that
  received the interaction, which is a synchronous DuckDB read. It declared no
  lake access while doing exactly that, and because the boot gate only runs for
  roles that declare access, the pod that needed the check was the one that
  skipped it — DuckDB scans zero parquet files rather than failing, so every
  question came back "no games found", successfully. Wave 6 settles this either
  by routing Discord-surface Explore turns through the `interactive` queue (the
  same mechanism this role already owes customs voice) or by giving the gateway
  Deployment the lake volume. Independently of the table, every in-process lake
  read now asserts the capability at the read site in
  `reports/duckdb/lake.ts`: a capability whose `false` skips a safety check
  cannot protect the role that sets it false.
- **`application` publishes the report lake**, and owns the collectors that
  sweep the database on every `/metrics` scrape. Every role serves `/metrics`,
  but running those four collectors on all of them would turn one Prometheus
  scrape interval into N full sweeps of the same tables.
- **Reading the lake is wider than publishing it, and it is why
  `activity-worker` is not deployable yet.** Every embedded Temporal activity
  queue reads the lake somewhere: `realtime` settles SQL dares and evaluates
  hall progression, `interactive` answers Explore queries, `background` runs
  reports, parlay generation and the summoner-index
  backfill, and `lake` is the compactor. Several of them also write its staging
  directories. So `activity-worker` needs the same volume `application` owns,
  and the cluster PVC is ReadWriteOnce — the two roles cannot both mount it as
  things stand. Splitting them needs the lake to become shareable (a remote
  store, or every reader moved behind the `lake` queue) first.
- **So the deployed split is combined-minus-shard, not the four-way one.**
  Because `activity-worker` cannot run yet, `application` carries `realtime`,
  `background` and the competition activity worker in the interim — marked
  `(interim)` in the table above. Moving the shard out without them would not
  redistribute that work, it would stop it: Riot polling, prematch, match
  ingest, report delivery and scheduled competition updates all live on those
  queues. `activity-worker` still declares them, so the two roles overlap on
  paper; that is safe only while exactly one of them is deployed, and the role
  tests pin the overlap so it cannot widen unnoticed. Hand these back when the
  lake becomes shareable.
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
- **`scout_temporal_workers`** reports 0 rather than going absent for a queue
  class this role does not run, and `/healthz` reports the running queue classes
  by name. `ScoutTemporalWorkerMissing` is built on that zero-fill, and asks
  whether a queue class that WAS being polled has stopped being polled — not
  whether every class has a poller, which would make a role nobody deploys a
  permanent firing condition.
- **Every metric carries a `role` label**, set as a registry default from this
  role's name. An alert reading a gauge only some roles produce must scope to
  those roles or it fires on a correct deployment; `ScoutDiscordDisconnected` is
  the worked example, and it scopes per stage because the gateway owner differs
  by stage.
- The externally deployed stable/candidate Workflow Workers
  (`temporal/workflow-worker.ts`) are unaffected by any of this.

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
