---
title: Pull a Scout database into local dev
description: Copy the beta or production Scout Postgres database onto your laptop and run the local app against real data.
sidebar:
  order: 12
---

Local Scout dev runs on fixtures and the seeded report lake. When you need real
rows — reproducing a bug that only appears with live data, or looking at a
populated screen — copy a hosted database into a local one.

## Copy the database

From `packages/scout-for-lol`:

```bash
bun run dev:db-pull
```

This dumps beta's `scout` database, restores it into `scout_beta_snapshot` on
the shared local dev Postgres, verifies every source table arrived, and prints
the command for the next step. `bun run dev:db-pull -- --help` lists the flags.

:::caution[The target database is replaced]
Every run drops and recreates it. Pass `--database <name>` to restore elsewhere
and keep an existing copy.
:::

:::note[Credentials never reach your laptop]
The snapshot carries no live secrets. `User.discordAccessToken`,
`discordRefreshToken`, `ExploreConversation.shareToken`, and
`TournamentLobby.password` arrive blanked; `TournamentLobby.code` — the Riot
join credential — arrives as a per-row `redacted-<id>` stand-in, because it is
`NOT NULL` and unique. `ApiToken` and `InstallAttributionToken` arrive empty:
their rows are nothing but credentials. The rows themselves are kept, so
ownership and joins still work. Redaction happens at the source, so no
credential is written here even transiently, and the run fails if any redacted
column comes back holding a real value.
:::

## Run the app against it

Use the URL the previous command printed:

```bash
bun run dev:web -- --database-url postgres://scout@127.0.0.1:5471/scout_beta_snapshot
```

`dev:web` applies any migrations newer than the snapshot as it boots, so a
database captured before a schema change still works.

## Pull from production

```bash
bun run dev:db-pull -- --stage prod
```

This puts real player data — aliases, Discord IDs, PUUIDs — on your laptop, and
the command warns when it runs. Credentials are excluded the same way as for
beta, but the identifiers are still real. Prefer beta unless the bug is
production-only.

:::danger[Do not hand-roll this with kubectl and pg_dump]
Three things fail silently. The Spilo pod carries several PostgreSQL toolchains
and `PATH` resolves to the newest — 18, against a 16 server — which writes an
archive the local client cannot read while still exiting 0. The cluster runs
`pg_stat_kcache` and `set_user`, which the local build does not ship, so
dumping them breaks the restore. And the dump's own `CREATE SCHEMA public`
collides with the one `createdb` provides, which under `--single-transaction`
rolls back everything.
[`dev-db-pull-plan.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/scout-for-lol/scripts/dev/dev-db-pull-plan.ts)
handles all three.
:::

## Related

- [Connect to a homelab database](/how-to/connect-to-a-homelab-database/)
- [Run the Scout design audit](/how-to/run-scout-design-audit/)
