---
title: Manage the FreshRSS repository feeds
description: Add, reconcile, verify, troubleshoot, and rotate credentials for the code-owned FreshRSS Repo Stack category.
sidebar:
  order: 9
---

Manage repository-related subscriptions in the `Repo Stack` category by editing
the canonical OPML and running its Kubernetes reconciler.

The reconciler owns that category exactly. It may unsubscribe any feed placed
there unless the feed is declared in code. Every other category remains
user-managed.

## 1. Change the declared feeds

Edit
[`feeds.opml`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/helm/freshrss/feeds.opml).
Keep one `Repo Stack` category and give each feed a unique public URL and title.
Never add a URL containing credentials.

Release feeds use `frss:filtersActionRead` to mark prerelease entries as read.
Preserve that attribute when changing a release feed.

Validate the OPML and rendered workload from the CDK8s workspace:

```bash
cd packages/homelab/src/cdk8s
bun test src/resources/freshrss-opml.test.ts \
  src/resources/freshrss-reconciler.test.ts \
  src/resources/freshrss.test.ts
bun run build
```

The
[`FreshRSS resource`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/freshrss.ts)
rejects malformed categories, duplicate URLs, credential-bearing URLs, and an
invalid managed boundary during synthesis.

## 2. Reconcile after deployment

ArgoCD deploys an hourly CronJob named `freshrss-sync`. It runs at minute 7,
before FreshRSS refreshes feeds at minute 13.

To reconcile immediately, choose a unique Job name:

```bash
kubectl create job \
  --namespace freshrss \
  --from=cronjob/freshrss-sync \
  freshrss-sync-manual-YYYYMMDDHHMM

kubectl wait \
  --namespace freshrss \
  --for=condition=complete \
  --timeout=5m \
  job/freshrss-sync-manual-YYYYMMDDHHMM
```

Then inspect the reconciliation result:

```bash
kubectl logs \
  --namespace freshrss \
  job/freshrss-sync-manual-YYYYMMDDHHMM
```

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

Inspect the latest Jobs and the failed Job's logs:

```bash
kubectl get jobs --namespace freshrss --sort-by=.metadata.creationTimestamp
kubectl logs --namespace freshrss job/<failed-job-name>
```

| Symptom                        | Check                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| Authentication failed          | `freshrss-sync` Secret population and the local settings reconciler logs   |
| API or malformed response      | FreshRSS availability and the response named in the reconciler error       |
| Final managed set is not exact | duplicate live URLs, renamed feeds, stale entries, and local settings logs |
| Unmanaged subscription change  | concurrent manual edits outside `Repo Stack`; rerun after they finish      |
| Job cannot connect to FreshRSS | `freshrss-ingress-netpol` and the Job pod's `app=freshrss-sync` label      |

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
updates user `sjerred`. Trigger a manual reconciliation and require it to
complete before considering the rotation finished.

If the item structure changed, refresh and verify the hashed vault snapshot:

```bash
cd packages/homelab/src/cdk8s
bun run scripts/snapshot-1password-vault.ts
bun run check:1password
```

## Related

- [Cut a homelab release](/how-to/cut-a-homelab-release/)
