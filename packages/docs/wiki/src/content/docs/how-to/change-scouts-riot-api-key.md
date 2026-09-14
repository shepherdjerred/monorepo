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

Budget a short maintenance window for the database rewrite, and days of
unattended running before it for the Riot lookups.

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
S3_BUCKET_NAME=scout-prod bun scripts/puuid-corpus.ts inventory \
  --cutover 2026-09-13T05:22:00Z --out prod.jsonl
S3_BUCKET_NAME=scout-beta bun scripts/puuid-corpus.ts inventory \
  --cutover 2026-09-12T22:40:00Z --out beta.jsonl
```

:::danger[Pass the cutover, or the run will fight itself]
Objects written after the key swap carry NEW-domain identifiers. Collecting
those feeds the old key exactly what it cannot decrypt — Riot answers 400 — so
they burn the scarcest budget in the migration and then appear as permanently
lost identities that were never lost at all. Excluding 425 post-cutover objects
in prod dropped 1,649 of them.

Use each environment's own boundary, with a few minutes of slack. Erring late
costs a handful of wasted lookups; erring early drops real old-domain
identities, and nothing recovers those once the old key is gone.
:::

It reads the **whole bucket**, not just the prefixes the report lake rebuilds
from. Identities also live under `failed-validations/` and in AI pipeline
output, and an inventory that enumerated only the expected prefixes would leave
them in the old domain permanently.

It runs once. Every object written since the key swap already carries
new-domain identifiers, so the set of old-domain identities is closed and cannot
grow while the next step runs for days. Nothing needs re-scanning afterwards.

`--prefix games/2026/01/` narrows a run, which is how a failed slice is retried
without re-reading 61 GiB.

## 3. Resolve every identity

Both hops, one identity at a time, gated by the old key's 0.67 requests per
second. At ~240k identities that is **three to four days**.

Seed a local SQLite file and work from that. The long run then needs only a Riot
key and an internet connection — no tunnel to hold open, nothing to lose when a
laptop sleeps or roams.

```bash
export DATABASE_URL="file:$HOME/puuid-harvest.sqlite"
export OLD_RIOT_API_KEY=… NEW_RIOT_API_KEY=…

# Create the file first. The migration opens databases with `create: false`, so
# that a mistyped path fails loudly instead of silently becoming an empty
# database that every phase then "succeeds" against. A scratch harvest file is
# the one case where you do want it created, so do it explicitly.
bun -e 'new (require("bun:sqlite").Database)(
  Bun.env.DATABASE_URL.slice("file:".length), { create: true }).close()'

bun scripts/migrate-puuid-key.ts seed --from prod.jsonl
bun scripts/migrate-puuid-key.ts seed --from beta.jsonl
bun scripts/migrate-puuid-key.ts resolve
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

Run `collect` and then `resolve` to catch anything registered since step 3.
`resolve` only works on identities already in the map, so skipping `collect`
leaves a new account invisible until `apply` refuses it mid-window.

## 5. Load the map and rewrite the databases

```bash
# on the laptop
bun scripts/migrate-puuid-key.ts export --out map.jsonl

# against each database
bun scripts/migrate-puuid-key.ts import --from map.jsonl
bun scripts/migrate-puuid-key.ts strand --accept-stranded
bun scripts/migrate-puuid-key.ts apply --apply
bun scripts/migrate-puuid-key.ts verify
```

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

## 6. Rewrite the archive

Both buckets, each against its own database — the rewrite reads the map from
`DATABASE_URL` and re-points that environment's artifact references:

```bash
# prod
S3_BUCKET_NAME=scout-prod bun scripts/puuid-corpus.ts rewrite           # dry run
S3_BUCKET_NAME=scout-prod bun scripts/puuid-corpus.ts rewrite --apply

# beta
S3_BUCKET_NAME=scout-beta bun scripts/puuid-corpus.ts rewrite           # dry run
S3_BUCKET_NAME=scout-beta bun scripts/puuid-corpus.ts rewrite --apply
```

Skipping either leaves that environment's archive mostly old-domain, so a
participant tracked after the key change still cannot be joined to the games
they already appear in — which is the whole point of the exercise.

No downtime. Live ingest keeps writing new-domain objects, which the pass skips,
and a rewritten object no longer names an old identity — so the run is
idempotent and resumable with no cursor to lose. Re-run it until it reports zero
failures.

It refuses to touch anything until the database `apply` has landed. Translating
the archive to an identifier the database does not hold would hide the players
it names.

`--cutover 2026-09-13T05:07:05Z` skips objects written after the key swap
without reading them. An optimization only: the body check is the authority.

## 7. Rebuild the report lakes

Both lakes are derived, so they pick the change up from the rewritten archive.
The remap fingerprint changes when the map grows, which already forces a full
rebuild rather than a fold.

## 8. Swap the credential

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

## 9. Scale back up and watch

Confirm ingestion resumes with no Riot errors, and that a tracked player's
prematch and postmatch reports both fire.

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

**Observability tags, logs and traces.** Sentry, Bugsink, Loki and Tempo keep
whatever they recorded, and age out on their own retention.

Rewriting the archive costs something real: it is no longer a byte-faithful copy
of what Riot returned, and re-serialization normalizes formatting on every
object that changes. That is the trade for a corpus whose identifiers still mean
something. See [Scout's report lake](/explanation/scout-report-lake/).

## Related

- [Scout's report lake](/explanation/scout-report-lake/) — why the raw record
  keeps old identifiers and what reads around them
- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
  — getting a copy to rehearse against
