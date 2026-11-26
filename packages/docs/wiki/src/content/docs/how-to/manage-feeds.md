---
title: Manage Feeds subscriptions and clients
description: Edit code-owned RSS and Atom feeds, manage private subscriptions, trigger refreshes, connect NetNewsWire, and rotate Feeds credentials.
sidebar:
  order: 9
---

Manage public repository and blog subscriptions in code, and keep private or
ad-hoc subscriptions in the live Feeds SQLite database.

[`@shepherdjerred/feeds`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feeds/README.md)
reconciles the code-owned `Repo Stack` and `Blogs` categories transactionally on
startup. Private subscriptions live in `Uncategorized` or custom categories and
redact query parameters across logs, errors, and UI tables.

## 1. Change code-owned feeds

Edit
[`catalog.ts`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feeds/src/catalog/catalog.ts).
Keep each entry in `Repo Stack` or `Blogs` with a unique public `https://` URL
and non-empty title.

:::caution
Never commit a credential-bearing URL to `catalog.ts`. Add private subscriber
feeds through the web console or NetNewsWire instead.
:::

Use `autoRead` on noisy release or firehose feeds to mark matching entries read
on ingest:

- `PRERELEASE_RULE` marks alpha, beta, RC, canary, nightly, preview, dev, and
  pre tags read automatically.
- `negate: true` marks every entry read unless the pattern matches, such as
  `AI_SDK_ONLY_RULE`.
- `hidden: true` hides high-volume feeds from the default `All` stream while
  retaining them in search and category filters.

Validate the catalog and server locally:

```bash
bunx turbo run build typecheck test lint --filter=@shepherdjerred/feeds
```

Merge the pull request. When `feeds/prod` deploys, startup reconciliation
upserts declared feeds and prunes removed `code` rows without touching `user`
subscriptions.

## 2. Manage private user feeds

Open `https://feeds.tailnet-1a49.ts.net` on the tailnet and click **Add feed**,
or subscribe from NetNewsWire.

- User-owned feeds cannot use the reserved `Repo Stack` or `Blogs` categories.
- Query strings on `user` feed URLs are stored for polling and rendered as
  `?[REDACTED]` in the **Feeds** health table and logs.
- Deleting or renaming a `code` feed from the UI or Google Reader API returns
  HTTP `403`.

## 3. Trigger or pause feed polling

Temporal polls upstream feeds on the
[`feeds-refresh`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/schedules/schedule-definitions-early.ts)
schedule listed in
[Temporal workflow inventory](/reference/temporal-workflows/#homelab-maintenance).

To trigger an immediate poll from the operator CLI:

```bash
toolkit temporal --namespace prod schedule trigger --schedule-id feeds-refresh
toolkit temporal --namespace prod schedule describe --schedule-id feeds-refresh
```

To pause background polling without redeploying, disable the
[`feeds-refresh-enabled`](https://github.com/shepherdjerred/monorepo/blob/main/packages/feature-flags/src/managed-flag-inventory.json)
flag in `feeds/prod` via
[Operate feature flags and check the inventory](/how-to/check-flag-inventory/).

## 4. Connect NetNewsWire

[`feeds.sjer.red`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/feeds/index.ts)
exposes only `/healthz` and `/api/greader.php/*` on the isolated reader
listener (`:7431`).

1. In NetNewsWire, add a **FreshRSS** account.
2. Set **Server** to `https://feeds.sjer.red/api/greader.php`.
3. Set **Username** to `sjerred` and **Password** to `FEEDS_READER_PASSWORD`
   from the `feeds-auth` item in the `Homelab (Kubernetes)` 1Password vault.

## 5. Diagnose failing feeds

Open the **Feeds** tab at `https://feeds.tailnet-1a49.ts.net` to sort failing
feeds to the top with HTTP status, sanitized error text, and backoff timestamps.

Inspect cluster logs and schedule state when needed:

```bash
kubectl --context admin@torvalds -n feeds logs deploy/feeds --tail=100
toolkit temporal --namespace prod schedule describe --schedule-id feeds-refresh
```

| Symptom                           | Check                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| `skippedByFlag: true` on refresh  | `toolkit flags get feeds/prod feeds-refresh-enabled`                                |
| Console returns HTTP `403`        | Tailscale ingress proxy health, `feeds-ingress-observer` RBAC, and operator login   |
| Temporal refresh HTTP `401`       | `FEEDS_MACHINE_TOKEN` alignment between `feeds` and `temporal-temporal-repo-worker` |
| Feed stuck in exponential backoff | Upstream HTTP status or `Retry-After` header; click **Refresh** after upstream fix  |
| SSRF guard refused target IP      | Feed DNS resolving to RFC1918, loopback, link-local, or Tailscale CGNAT space       |

## 6. Rotate Feeds credentials

Update the secret fields in the `feeds-auth` item in the `Homelab (Kubernetes)`
1Password vault without printing values in a terminal:

- `FEEDS_READER_PASSWORD` authenticates NetNewsWire `ClientLogin` and HMAC-binds
  bearer tokens, so rotating it invalidates existing mobile sessions immediately.
- `FEEDS_WRITE_TOKEN_SECRET` signs short-lived `/reader/api/0/token` CSRF tokens.
- `FEEDS_MACHINE_TOKEN` authenticates Temporal `POST /internal/refresh`.

Restart the consumers after the 1Password operator updates both Kubernetes
Secrets:

```bash
kubectl --context admin@torvalds -n feeds rollout restart deploy/feeds
kubectl --context admin@torvalds -n temporal rollout restart deploy/temporal-temporal-repo-worker
```

If field names on `feeds-auth` changed, refresh and verify the vault snapshot:

```bash
bun run --cwd packages/homelab/src/cdk8s scripts/snapshot-1password-vault.ts
bun run --cwd packages/homelab/src/cdk8s check:1password
```

## Related

- [Cut a homelab release](/how-to/cut-a-homelab-release/)
- [Operate feature flags and check the inventory](/how-to/check-flag-inventory/)
