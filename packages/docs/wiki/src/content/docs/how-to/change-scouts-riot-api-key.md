---
title: Change Scout's Riot API key
description: Re-domain every stored PUUID onto a new Riot key, swap the credential, and prove no identity was stranded.
sidebar:
  order: 12
---

Riot encrypts PUUIDs per API-key holder, so moving Scout to a different key
invalidates every identifier it has stored. Refreshing a key in place does not;
only crossing between holders does. This guide re-domains the stored identities
across both databases and the raw archive, swaps the credential, and verifies
the result.

Budget days of unattended running for the Riot lookups, and a short maintenance
window for the database rewrite. Only steps 4 to 7 need the backends down; the
archive rewrite and the lake rebuilds run with everything live.

:::danger[The first hop is a one-way door]
Only the **old** key can say who an old PUUID belongs to. Once it is retired,
Riot cannot tell you. Never retire it until `verify` has passed.
:::

## How the migration works

The Riot ID (`gameName#tagLine`) is key-independent, so it bridges the two
domains:

```text
old PUUID --(old key)--> Riot ID --(new key)--> new PUUID
```

Two scripts run it, one per store. Every phase is resumable and safe to re-run.

[`migrate-puuid-key.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/scripts/migrate-puuid-key.ts)
owns the databases:

| Phase     | Does                                                    | Key used |
| --------- | ------------------------------------------------------- | -------- |
| `begin`   | Opens a new key-transition scope                        | none     |
| `collect` | Finds every PUUID-bearing column, then every identity   | none     |
| `seed`    | Adds identities from a corpus inventory                 | none     |
| `resolve` | old PUUID → Riot ID → new PUUID, both hops per identity | both     |
| `apply`   | Rewrites every stored reference                         | none     |
| `strand`  | Accepts identities Riot can no longer resolve           | none     |
| `verify`  | Asserts no old-domain identity survives                 | none     |

[`puuid-corpus.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/scripts/puuid-corpus.ts) owns S3:

| Phase       | Does                                                   |
| ----------- | ------------------------------------------------------ |
| `inventory` | Lists every distinct identity the archive has recorded |
| `rewrite`   | Re-domains every object, in place                      |

### Scope is a decision, and it is expensive to get wrong

Re-domaining only the players Scout _watches_ is far cheaper, and it is what the
first migration did. The consequence, measured afterwards: of 174,573 distinct
participant PUUIDs in prod's archive, 167 were mapped. The corpus stayed 99.9
percent old-domain by identity.

That is not cosmetic. A player who becomes tracked later carries a new-domain
identifier while their appearances in games already archived carry an old one,
so their history before they were subscribed is invisible, permanently.

Covering everyone means resolving every participant ever seen. Budget days, not
hours.

## 0. Name the three databases

Every later command says which one it means. Nothing is exported, because an
inherited `DATABASE_URL` is the single easiest way to run a step against the
wrong store — and the failure is silent: `verify` will pass against a scratch
map while neither live database has been touched.

```bash
export TRANSITION=2026-09-13                              # the date of this swap
SCRATCH="file:$HOME/puuid-harvest-$TRANSITION.sqlite"     # the laptop's working map
PROD_DB="…"                                               # prod's own database
BETA_DB="…"                                               # beta's own database
```

`TRANSITION` is exported because the file-creation command below reads it; it
names a file, not a store, so it carries none of the risk that keeps
`DATABASE_URL` unexported.

The scratch file is named for the transition, and a later one must never reuse
it. The live map is retained across transitions so backups can still be
translated; `begin --new-transition` resets only the current cutover marker after
the previous map is complete. `seed` treats a previous replacement as a valid
input for the next transition, while duplicate old-side rows are still skipped.

### Open a later transition explicitly

Before collecting a later transition, reset the current marker in each live
database while retaining the map history:

```bash
# per database, against $PROD_DB and $BETA_DB in turn
DATABASE_URL="$PROD_DB" bun scripts/migrate-puuid-key.ts begin --new-transition
DATABASE_URL="$BETA_DB" bun scripts/migrate-puuid-key.ts begin --new-transition
```

Skipping this fails late and badly. `collect` refuses to record a tracked
identity once a cutover marker stands, while reusing the old marker would judge
the next transition against the previous boundary. `begin` refuses if the
previous map still has unresolved work, so the marker cannot be reset while the
old transition is incomplete.

The read-time remap composes retained mappings to their terminal replacement.
Thus old₁→old₂ beside old₂→new₃ still translates a restore from before the first
rewrite directly to new₃.

## 1. Back up both databases

Prod is SQLite on the backend pod's volume. Take a compacted copy — a plain copy
will not fit, and an in-place `VACUUM` is not an option on a live file:

```sql
VACUUM INTO '/data/backups/pre-puuid-migration.sqlite';
```

Beta is Postgres. Use `pg_dump -Fc`, and restore-verify it with the **server's**
`pg_restore`, not your local one.

## 2. Inventory the archive

From inside the cluster, or through a port-forward to SeaweedFS. This is the
only step that needs S3, and it needs no Riot key at all.

```bash
S3_BUCKET_NAME=scout-prod bun scripts/puuid-corpus.ts inventory --out prod.jsonl
S3_BUCKET_NAME=scout-beta bun scripts/puuid-corpus.ts inventory --out beta.jsonl
```

:::caution[`--cutover` is for a retrofit, not a fresh transition]
Following this guide from the top, the credential has not been swapped yet, so
every object in the archive is old-domain and there is nothing to exclude.
**Do not pass a cutover here**, and never copy one from a previous migration:
a boundary from an earlier transition excludes nearly everything written under
today's old key, and the omission only surfaces in step 4 — after the backends
are down, turning a short maintenance window into another multi-day resolve.

Pass one only when re-domaining an archive whose swap **already happened**. Then
it matters a great deal: objects written after that swap carry new-domain
identifiers, and collecting them feeds the old key exactly what it cannot
decrypt. Riot answers 400, the scarcest budget in the migration is spent on
them, and they surface as permanently lost identities that were never lost.
Measure each environment's own boundary — the last object holding an old-domain
identifier — and allow a few minutes of slack. Erring late costs a handful of
wasted lookups; erring early drops real identities, and nothing recovers those
once the old key is gone.
:::

It reads the **whole bucket**, not just the prefixes the report lake rebuilds
from. Identities also live under `failed-validations/` and in AI pipeline
output, and an inventory that enumerated only the expected prefixes would leave
them in the old domain permanently.

**This is not the only inventory you will need.** The set of old-domain
identities is closed only once the credential has actually been swapped, and
that does not happen until step 8. Scout keeps ingesting with the old key
throughout the multi-day resolve, so every game archived between here and step 4
adds identities this pass cannot have seen. Step 4 re-runs it after the writes
stop.

The one case where a single pass suffices is a corpus whose cutover already
happened — there the boundary is in the past and nothing can extend it.

`--prefix games/2026/01/` narrows a run, which is how a failed slice is retried
without re-reading 61 GiB.

## 3. Resolve every identity

Both hops, one identity at a time, gated by the old key's 0.67 requests per
second. At ~240k identities that is **three to four days**.

Seed a local SQLite file and work from that. The long run then needs only a Riot
key and an internet connection — no tunnel to hold open, nothing to lose when a
laptop sleeps or roams.

```bash
export OLD_RIOT_API_KEY=… NEW_RIOT_API_KEY=…

# Create the file first. The migration opens databases with `create: false`, so
# that a mistyped path fails loudly instead of silently becoming an empty
# database that every phase then "succeeds" against. A scratch harvest file is
# the one case where you do want it created, so do it explicitly.
bun -e 'new (require("bun:sqlite").Database)(
  `${process.env.HOME}/puuid-harvest-${process.env.TRANSITION}.sqlite`,
  { create: true }).close()'

DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts seed --from prod.jsonl
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts seed --from beta.jsonl
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts resolve
```

One map serves both environments: they ran on the same old key, so an old PUUID
means the same player in either.

:::caution[The archived Riot ID is not the answer]
Every payload carries the handle each player had at game time, which makes it
tempting to skip the old-key hop. Sampled against the old key, **4 of 25
identities from 8-month-old games had renamed since**. A stale handle either
404s or resolves to whoever claimed it — a 200, for the wrong person. `resolve`
always re-derives from the old key.
:::

### Surviving a multi-day run

Supervise it with a launchd agent — `RunAtLoad` plus `KeepAlive`, wrapped in
`caffeinate -ims` — and let it restart through sleeps, network changes and
reboots. Keep the plist out of chezmoi and remove it when the run finishes.

`resolve` waits out a full rate-limit window before its first request, because a
restarted process cannot know how much of the window its predecessor spent.
That is what makes `KeepAlive` safe: a crash loop cannot become a burst. Pass
`--no-wait-window` only for short interactive runs.

Take the key from 1Password with `op run` so it never lands on disk or in the
plist.

Gate on three things: zero collisions, zero unresolved, and every new identifier
differing from its old one. The script enforces all three
([`phases.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/scripts/puuid-migration/phases.ts)); an
identifier that comes back unchanged means both keys belong to one holder, and
the run stops.

:::caution[The old key's quota is shared with live traffic]
Both environments poll Riot on that same key. Harvest deliberately claims only
half its two-minute budget so ingestion is not starved.
:::

Run the two environments sequentially for the same reason.

## 4. Scale down and catch the delta

Scaling `scout-backend` to zero is the only thing that stops Riot writes; there
is no maintenance flag for core ingestion. It is a routine operation — the
deployment already replaces rather than rolls
([`scout/index.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/scout/index.ts)). Leave
`scout-workflow-worker` up: the realtime poll workflow skips a stale poll rather
than queueing it
([`realtime.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/temporal/src/workflows/realtime.ts)),
so there is no catch-up dogpile on restart.

:::caution[Prod's database leaves with the pod]
Prod's SQLite lives on a ReadWriteOnce volume mounted by the backend pod
([`scout/index.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/scout/index.ts)), so
scaling that pod to zero also removes the only way to run the migration. Create
a short-lived pod mounting `scout-storage-claim` to hold the volume, and delete
it before scaling back up so the backend can remount.
:::

Now that nothing is writing with the old key, re-run **both** discoveries to
catch everything archived while the resolve was running.

:::note[Retrofitting an already-swapped archive? Skip this whole step]
If the credential was swapped before this migration began, there is no delta to
catch. Nothing has written an old-domain identity since — the set closed before
step 2 — so neither half of this step finds anything new, and both halves do
harm if run anyway.

The archive half collects healthy post-swap identities; the old key answers 400
for every one, and `strand` then records as permanently lost identities that
were never lost. The database half does the same for accounts registered since
the swap.

`collect` should refuse outright, because a retrofit requires the cutover marker
to be recorded first and `collect` will not run against a database that already
reports one. If it does not refuse, the marker is missing — record it before
going any further, or every account added since the swap is about to be sent to
a key that cannot read it.
:::

```bash
# the archive, again — days of games have been added since step 2
S3_BUCKET_NAME=scout-prod bun scripts/puuid-corpus.ts inventory --out prod-2.jsonl
S3_BUCKET_NAME=scout-beta bun scripts/puuid-corpus.ts inventory --out beta-2.jsonl
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts seed --from prod-2.jsonl
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts seed --from beta-2.jsonl

# and the databases — each one, pointed at itself
DATABASE_URL="$PROD_DB" bun scripts/migrate-puuid-key.ts collect
DATABASE_URL="$PROD_DB" bun scripts/migrate-puuid-key.ts export --out delta-prod.jsonl
DATABASE_URL="$BETA_DB" bun scripts/migrate-puuid-key.ts collect
DATABASE_URL="$BETA_DB" bun scripts/migrate-puuid-key.ts export --out delta-beta.jsonl

# bring those identities into the scratch map and resolve everything new
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts import --from delta-prod.jsonl
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts import --from delta-beta.jsonl
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts resolve
```

:::caution[Every command reads whatever `DATABASE_URL` points at]
Pointed at the wrong store, `collect` finds nothing and looks like it worked —
so a player subscribed during the multi-day resolve is never added, and `apply`
refuses on that stray mid-window with no way to resolve it before the old key is
retired. This is why nothing here is exported.
:::

`seed` skips anything the map already knows, so the second inventory only adds
what is genuinely new. Omit it and those identities are absent from the map: the
rewrite skips them, and retiring the old key makes them unrecoverable.

No cutover on these — the swap has not happened yet, so everything in the
archive is still old-domain.

## 5. Load the map and rewrite the databases

```bash
DATABASE_URL="$SCRATCH" bun scripts/migrate-puuid-key.ts export --out map.jsonl

for DB in "$PROD_DB" "$BETA_DB"; do
  DATABASE_URL="$DB" bun scripts/migrate-puuid-key.ts import --from map.jsonl
  DATABASE_URL="$DB" bun scripts/migrate-puuid-key.ts strand --accept-stranded
  DATABASE_URL="$DB" bun scripts/migrate-puuid-key.ts apply --apply
  DATABASE_URL="$DB" bun scripts/migrate-puuid-key.ts verify
done
```

:::danger[A green `verify` against the scratch map means nothing]
These commands must name a live database. Run against the scratch file they
import, apply and verify happily while prod and beta are untouched — and the
run looks like a complete success.
:::

`strand` writes off identities Riot can no longer resolve. It is separate and
flag-gated because it is permanent: those keep old-domain values, and once the
old key is retired nothing can revisit the decision. Read the count before
accepting it.

`apply` refuses while any identity is unresolved and undecided. `verify` must
report zero old-domain rows and a recorded cutover. Record the pre-apply count
first so there is something to compare against.

:::danger[Databases before S3]
Do the databases first. While the archive is part-rewritten, the report lake
still translates the objects that have not moved yet — so the lake stays
consistent at every moment. Rewriting S3 first inverts that.
:::

## 6. Swap the credential

Update `RIOT_API_KEY` in both 1Password items. Beta's item also feeds local dev
through `dev-web.env.tpl`.

Wait for the operator to sync, then confirm both Kubernetes secrets carry the
new key before scaling anything up.

:::danger[The danger window]
Between `apply` and a confirmed swap, the database holds new-domain identifiers
while the app still has the old key. Nothing may scale up until both secrets are
confirmed.
:::

Check the tier landed by reading `X-App-Rate-Limit` off any response. Production
reports `500:10,30000:600`.

## 7. Scale back up — the outage ends here

Confirm ingestion resumes with no Riot errors, and that a tracked player's
prematch and postmatch reports both fire.

The remaining steps are deliberately outside the window. The archive rewrite
reads and writes tens of gigabytes and the lake rebuilds take hours; holding the
outage open across them would turn a short database window into most of a day
for no benefit. Nothing in them needs the backends down.

## 8. Rewrite the archive, with everything running

First wait out the prematch snapshots, because `--apply` refuses without it.
The reason is below; the check is that no game live during the outage is still
waiting to resume.

Both buckets, each against its own database — the rewrite reads the map from
`DATABASE_URL` and re-points that environment's artifact references:

```bash
# prod
DATABASE_URL="$PROD_DB" S3_BUCKET_NAME=scout-prod \
  bun scripts/puuid-corpus.ts rewrite                                   # dry run
DATABASE_URL="$PROD_DB" S3_BUCKET_NAME=scout-prod \
  bun scripts/puuid-corpus.ts rewrite --apply --prematch-drained

# beta
DATABASE_URL="$BETA_DB" S3_BUCKET_NAME=scout-beta \
  bun scripts/puuid-corpus.ts rewrite                                   # dry run
DATABASE_URL="$BETA_DB" S3_BUCKET_NAME=scout-beta \
  bun scripts/puuid-corpus.ts rewrite --apply --prematch-drained
```

Both environments need the flag. Beta holds prematch receipts too, so an applied
run there stops at the same gate.

The rewrite reads its map from `DATABASE_URL` and re-points that environment's
artifact references, so the database and the bucket have to be the same
environment's. Pointed at the scratch map it would load mappings the live
database has not applied, and reconcile nothing.

Skipping either leaves that environment's archive mostly old-domain, so a
participant tracked after the key change still cannot be joined to the games
they already appear in — which is the whole point of the exercise.

Scout is serving traffic throughout this step, which is why it comes after the
scale-up rather than inside the window. Live ingest writes new-domain objects
and the pass skips them; a rewritten object no longer names an old identity, so
the run is idempotent and resumable with no cursor to lose. Re-run it until it
reports zero failures.

The report lake stays consistent the whole time: a rewritten object needs no
translation, and one not yet reached still gets it from the map applied in
step 5.

One reader is not safe to run hot, and the rewrite refuses until you say it has
drained. A prematch snapshot is read back and checked against its receipt, and
`prematch-resume.ts` treats a mismatch as non-retryable — it drops the rest of
that match's lake projection and its notifications, permanently. The rewrite
moves the receipt with the bytes, but a PUT and a database write are not one
transaction, so a resume landing between them sees the two disagree.

A game running across the outage is the case that bites: its snapshot was
captured under the old key, so the rewrite touches it, and its workflow resumes
when the game ends twenty to forty minutes later. Snapshots captured after the
swap name nobody in the map and are skipped.

So wait out the games that were live during the window and confirm no prematch
workflow from before the swap is still open. That is what `--prematch-drained`
asserts, in both environments.

It refuses to touch anything until the database `apply` has landed. Translating
the archive to an identifier the database does not hold would hide the players
it names.

The rewrite takes no cutover, unlike the inventory. Rewriting an object advances
its modification time, so filtering on it would exclude exactly the objects a
re-run needs to inspect — one whose upload landed while its database update did
not. It would save under one percent of reads and cost that recovery.

## 9. Rebuild the report lakes

Both lakes are derived, so they pick the change up from the rewritten archive.
The remap fingerprint changes when the map grows, which already forces a full
rebuild rather than a fold.

## What stays in the old domain

**Identities Riot can no longer resolve.** A deleted or transferred account has
no Riot ID to bridge with, so it keeps its old identifier forever. `verify`
reports the count.

**Backups, for their retention window** — 30 daily, 8 weekly, 12 monthly. A
restore from before the rewrite reintroduces old-domain identifiers, which is
why the read-time remap
([`puuid-remap.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/report-lake/puuid-remap.ts))
stays in place. Once the archive holds no old identifiers it is a no-op, and it
is still correct for a restore and for stranded identities.

It composes the retained mappings to their terminal replacement, so a restore
predating any earlier transition still lands in the current domain. Keep the
previous rows in the live map when starting a later transition; dropping or
renaming them would remove the history this recovery path needs.

**Observability tags, logs and traces.** Sentry, Bugsink, Loki and Tempo keep
whatever they recorded, and age out on their own retention.

Rewriting the archive costs something real: it is no longer a byte-faithful copy
of what Riot returned. Only the identifiers change — the rewrite substitutes
tokens rather than re-serializing, so formatting and every other byte survive —
but the record now says something Riot never said. That is the trade for a
corpus whose identifiers still mean something. See [Scout's report lake](/explanation/scout-report-lake/).

## Related

- [Scout's report lake](/explanation/scout-report-lake/) — why the raw record
  keeps old identifiers and what reads around them
- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
  — getting a copy to rehearse against
