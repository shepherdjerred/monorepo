---
title: Rotate the DDNS credential
description: Replace the Cloudflare DDNS API token and verify the Temporal ddns-sync schedule.
---

Replace the Cloudflare API token read by
[`syncDdnsRecords`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/infra/ddns.ts)
on
[`temporal-infra-worker`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/temporal/workers/operations-workers.ts)
before revoking the previous token.

## 1. Update the owning 1Password item

Create a replacement Cloudflare API token with DNS edit permission on the
`sjer.red` zone.
Update the `api_token` field on the owning 1Password item
(`nhyb6lnjpvjsau2gkmb7n42oeq`) synced to `Secret/temporal-ddns-api-token` in
namespace `temporal`.
Use 1Password or a non-printing authenticated write; keep tokens out of files,
command arguments, and output.

## 2. Refresh the infrastructure worker

Wait for the operator-managed `Secret/temporal-ddns-api-token` to reflect the
updated field, then restart `temporal-infra-worker` so `/run/secrets/ddns/api-token`
updates immediately:

```bash
kubectl -n temporal rollout restart deployment/temporal-temporal-infra-worker
kubectl -n temporal rollout status deployment/temporal-temporal-infra-worker
```

## 3. Verify the replacement

Trigger an immediate `ddns-sync` run and confirm it completes without errors:

```bash
toolkit temporal schedule trigger --schedule-id ddns-sync
```

Check the updated records against the [hostname contracts](/reference/dynamic-dns/)
and confirm `DdnsSyncStale` and `DdnsUpdateFailing` stay clear.
Revoke the previous token only after `ddns-sync` succeeds for both hostnames.

## Related

- [Dynamic home DNS](/reference/dynamic-dns/)
- [Cut over Mario Kart to direct HTTPS](/how-to/cut-over-mario-kart-direct-ingress/)
