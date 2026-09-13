---
title: Change Scout's Riot API key
description: Re-domain every stored PUUID onto a new Riot key, swap the credential, and prove no identity was stranded.
sidebar:
  order: 12
---

Riot encrypts PUUIDs per API-key holder, so moving Scout to a different key
invalidates every identifier it has stored. Refreshing a key in place does not;
only crossing between holders does. This guide re-domains the stored identities,
swaps the credential, and verifies the result.

Budget a maintenance window. `scout-backend` is down in both environments for
the middle of it.

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

[`migrate-puuid-key.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/scripts/migrate-puuid-key.ts) runs
that in five resumable phases. Each is safe to re-run.

| Phase     | Does                                                                   | Key used |
| --------- | ---------------------------------------------------------------------- | -------- |
| `collect` | Finds every PUUID-bearing column, then every distinct tracked identity | none     |
| `harvest` | old PUUID → Riot ID                                                    | old      |
| `resolve` | Riot ID → new PUUID                                                    | new      |
| `apply`   | Rewrites every stored reference                                        | none     |
| `verify`  | Asserts no old-domain identity survives                                | none     |

Only **tracked** players are re-domained. Scout stores a PUUID for every match
participant, but those are opaque strings it never resolves or displays. They
keep their old values, and `collect` reports the count. What counts as tracked
is the declared source list in
[`support.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/scripts/puuid-migration/support.ts), which names
the few columns that are records of who was _seen_ rather than who is _watched_.

## 1. Back up both databases

Prod is SQLite on the backend pod's volume. Take a compacted copy — a plain copy
will not fit, and an in-place `VACUUM` is not an option on a live file:

```sql
VACUUM INTO '/data/backups/pre-puuid-migration.sqlite';
```

Beta is Postgres. Use `pg_dump -Fc`, and restore-verify it with the **server's**
`pg_restore`, not your local one.

## 2. Dry-run against both, live

Run `collect`, `harvest`, then `resolve` with the app still running. Nothing is
rewritten, so this is safe hot.

```bash
OLD_RIOT_API_KEY=… NEW_RIOT_API_KEY=… DATABASE_URL=… \
  bun scripts/migrate-puuid-key.ts collect
```

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

## 3. Scale down and re-run the delta

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

Re-run all three of `collect`, `harvest`, and `resolve` to catch anything
written since step 2. `harvest` and `resolve` only work on identities already in
the map, so skipping `collect` leaves an account registered in between invisible
until `apply` refuses it mid-window.

## 4. Apply and verify

```bash
bun scripts/migrate-puuid-key.ts apply --apply
bun scripts/migrate-puuid-key.ts verify
```

`apply` refuses unless every tracked identity resolved. `verify` must report
zero old-domain rows. Record the pre-apply count first so you have something to
compare against.

## 5. Swap the credential

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

## 6. Scale back up and watch

Confirm ingestion resumes with no Riot errors, and that a tracked player's
prematch and postmatch reports both fire.

## What stays in the old domain

Raw S3 payloads are the record and are never rewritten. The lake translates them
at rebuild instead
([`puuid-remap.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/packages/backend/src/report-lake/puuid-remap.ts)),
so an environment gets continuous history only once that code is deployed there.
See
[Scout's report lake](/explanation/scout-report-lake/).

Untracked participants, historical backups, and observability tags also keep
their old values. A restore from a backup taken before the cutover reintroduces
old-domain identifiers.

## Related

- [Scout's report lake](/explanation/scout-report-lake/) — why the raw record
  keeps old identifiers and what reads around them
- [Pull a Scout database into local dev](/how-to/pull-a-scout-database-into-local-dev/)
  — getting a copy to rehearse against
