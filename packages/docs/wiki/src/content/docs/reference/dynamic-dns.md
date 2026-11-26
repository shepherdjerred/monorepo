---
title: Dynamic home DNS
description: Hostname ownership, address families, and credential inputs for the Temporal home DDNS sync.
---

The `ddns-sync` Temporal schedule runs
[`syncDdnsRecords`](https://github.com/shepherdjerred/monorepo/blob/main/packages/temporal/src/activities/infra/ddns.ts)
on `temporal-infra-worker` to maintain home-address records in Cloudflare.
Application CNAME records belong to the
[Cloudflare stack](https://github.com/shepherdjerred/monorepo/tree/main/packages/homelab-cdktn/src/stacks/cloudflare).

| Hostname             | Address families                          | Record policy                               |
| -------------------- | ----------------------------------------- | ------------------------------------------- |
| `ddns.sjer.red`      | IPv4 (`A`) and IPv6 (`AAAA` when present) | DNS-only (`proxied: false`), 300-second TTL |
| `ipv4.ddns.sjer.red` | IPv4 (`A`) only                           | DNS-only (`proxied: false`), 300-second TTL |

`ipv4.ddns.sjer.red` omits `AAAA` records so CNAME targets backed by IPv4-only
router forwards never resolve over IPv6.

[`temporal-infra-worker`](https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/cdk8s/src/resources/temporal/workers/worker.ts)
projects only the `api_token` field from `Secret/temporal-ddns-api-token` in
namespace `temporal` to `/run/secrets/ddns/api-token`
(`CLOUDFLARE_DDNS_API_TOKEN_FILE`).
Credential replacement is covered by
[Rotate the DDNS credential](/how-to/rotate-ddns-credentials/).

## Related

- [Homelab networking](/explanation/homelab/overview/)
- [Temporal workflow inventory](/reference/temporal-workflows/)
