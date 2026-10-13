---
title: Dynamic home DNS
description: Hostname ownership, address families, and credential inputs for the home DDNS deployment.
---

The [DDNS deployment](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/ddns.ts)
maintains home-address records in Cloudflare.
Application CNAME records belong to the
[Cloudflare stack](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/tofu/cloudflare/sjer-red.tf).

| Hostname             | Address families  | Configuration                                                |
| -------------------- | ----------------- | ------------------------------------------------------------ |
| `ddns.sjer.red`      | Secret-configured | Existing `config.json` in the Cloudflare DDNS 1Password item |
| `ipv4.ddns.sjer.red` | IPv4 only         | `ipv4-ddns` container in the DDNS chart                      |

The deployment defines the IPv4-only target as DNS-only with a 300-second TTL.
Its IPv6 provider is disabled.
Both containers use the image pinned in the
[version catalog](https://github.com/shepherdjerred/monorepo/blob/main/packages/version-catalog/src/catalog.json).

The deployment projects the `api_token` field of the same
1Password item used by the existing updater. Its Secret projection exposes
only that field as a file to the IPv4 updater.
Credential replacement is covered by
[Rotate the DDNS credential](/how-to/rotate-ddns-credentials/).

## Related

- [Homelab networking](/explanation/homelab/overview/)
