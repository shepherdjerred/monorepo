---
title: Rotate the DDNS credential
description: Replace the shared DDNS API token and verify both updater containers.
---

Replace the credential for both containers in the
[DDNS deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/ddns.ts)
before revoking the previous token.

## 1. Update the owning 1Password item

Create a replacement Cloudflare token with the existing zone permissions.
Update the Cloudflare DDNS item's `api_token` field and
`config.json`'s `cloudflare[].authentication.api_token` together.
Keep the rest of the JSON configuration intact.
Use 1Password or a non-printing authenticated write; keep tokens out of files,
command arguments, and output.

## 2. Refresh both containers

Wait for the operator-managed Kubernetes Secret to reflect both updated fields.
Restart the deployment so both containers load the replacement credential:

```bash
kubectl -n ddns rollout restart deployment/ddns
kubectl -n ddns rollout status deployment/ddns
```

## 3. Verify the replacement

Confirm both containers complete an authenticated DNS update without errors.
Check the records against the [hostname contracts](/reference/dynamic-dns/).
Revoke the previous token only after both updater instances succeed.

## Related

- [Dynamic home DNS](/reference/dynamic-dns/)
- [Cut over Mario Kart to direct HTTPS](/how-to/cut-over-mario-kart-direct-ingress/)
