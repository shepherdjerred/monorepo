---
title: Manage the FreshRSS repository feeds
description: Add, reconcile, verify, troubleshoot, and rotate credentials for the code-owned FreshRSS Repo Stack category.
sidebar:
  order: 9
---

Manage repository-related subscriptions in the `Repo Stack` category by editing
the canonical OPML and running the Temporal reconciliation workflow.

The workflow owns that category exactly. It may unsubscribe any feed placed
there unless the feed is declared in code. Every other category remains
user-managed.

## 1. Change the declared feeds

Edit
[`feeds.opml`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/helm/freshrss/feeds.opml).
Keep one `Repo Stack` category and give each feed a unique public URL and title.
Never add a URL containing credentials.

Release feeds use `frss:filtersActionRead` to mark prerelease entries as read.
Preserve that attribute when changing a release feed.

Validate the OPML and rendered workloads from the CDK8s workspace:

```bash
cd packages/homelab/src/cdk8s
bun test src/resources/freshrss-opml.test.ts \
  src/resources/freshrss.test.ts
bun run build

cd ../../../temporal
bun --no-install --bun vitest --config ../../vitest.config.ts run \
  src/activities/maintenance/freshrss-reconciler.test.ts
```

The
[`FreshRSS resource`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/freshrss.ts)
rejects malformed categories, duplicate URLs, credential-bearing URLs, and an
invalid managed boundary during synthesis.

## 2. Reconcile the category

Temporal maintains the `freshrss-sync-hourly` schedule at minute 7 in
`America/Los_Angeles`, before FreshRSS refreshes feeds at minute 13.

To reconcile immediately, trigger the schedule through the operator CLI:

```bash
toolkit temporal schedule trigger --schedule-id freshrss-sync-hourly
toolkit temporal schedule describe --schedule-id freshrss-sync-hourly
```

Use the Temporal UI to inspect the resulting workflow history:
`https://temporal-ui.tailnet-1a49.ts.net`.

A successful run reports the desired, edited, and pruned counts. It also waits
for the local settings reconciler to apply exact release filters, then fails if
the final URL, title, and filter state is not exact or an unmanaged
subscription changes during the run.

## 3. Verify the live category

Export the live account from the FreshRSS pod:

```bash
kubectl exec \
  --namespace freshrss \
  deployment/freshrss \
  -- php /var/www/FreshRSS/cli/export-opml-for-user.php --user sjerred \
  > /tmp/freshrss-live.opml
```

Review the export locally. Confirm the `Repo Stack` URL and title set matches
`feeds.opml`, release feeds retain their read filters, and other categories are
unchanged. Do not commit the export until credential-bearing private feed URLs
have been removed.

## 4. Diagnose a failed reconciliation

Inspect the schedule and its recent actions:

```bash
toolkit temporal schedule describe --schedule-id freshrss-sync-hourly
kubectl logs \
  --namespace temporal \
  deployment/temporal-temporal-repo-worker
```

| Symptom                        | Check                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| Authentication failed          | `freshrss-sync` Secret population and the local settings reconciler logs   |
| API or malformed response      | FreshRSS availability and the response named in the workflow history       |
| Final managed set is not exact | duplicate live URLs, renamed feeds, stale entries, and local settings logs |
| Unmanaged subscription change  | concurrent manual edits outside `Repo Stack`; rerun after they finish      |
| Workflow cannot connect        | FreshRSS and Temporal NetworkPolicies, service endpoints, and worker logs  |

The local settings reconciler runs beside FreshRSS. It retries API password
setup until user `sjerred` exists, reapplies a rotated password, and makes the
declared read filters exact. Inspect it without printing the Secret:

```bash
kubectl logs \
  --namespace freshrss \
  deployment/freshrss \
  --container reconcile-local-settings
```

## 5. Rotate the API password

Generate a new password in the `freshrss-sync` item in the homelab 1Password
vault. Do not copy it into the repository or terminal.

Wait for the 1Password operator to update the Kubernetes Secret. The password
local settings reconciler detects the mounted value within 30 seconds and
updates user `sjerred`. Trigger the Temporal schedule and require it to
complete before considering the rotation finished.

If the item structure changed, refresh and verify the hashed vault snapshot:

```bash
cd packages/homelab/src/cdk8s
bun run scripts/snapshot-1password-vault.ts
bun run check:1password
```

## Related

- [Cut a homelab release](/how-to/cut-a-homelab-release/)
