---
title: Dynamic home DNS
description: Hostname ownership, address families, and credential inputs for the home DDNS deployment.
---

The `ddns` deployment maintains home-address records in Cloudflare. These
records are owned by the updater rather than OpenTofu; application CNAME
records remain in the Cloudflare stack.

| Hostname             | Address families | Configuration                                                |
| -------------------- | ---------------- | ------------------------------------------------------------ |
| `ddns.sjer.red`      | IPv4 and IPv6    | Existing `config.json` in the Cloudflare DDNS 1Password item |
| `ipv4.ddns.sjer.red` | IPv4 only        | `ipv4-ddns` container in the DDNS chart                      |

The IPv4-only target supports services exposed through the router's IPv4
forwards, including Mario Kart. Both updater instances use the same pinned
image. The new target is DNS-only with a 300-second TTL and follows public
IPv4 changes without inheriting the shared hostname's AAAA records.

The IPv4 updater reads its API token from the `api_token` field of the same
1Password item used by the existing updater. Its Secret projection exposes
only that field as a file. When rotating the DDNS credential, update both
`api_token` and `config.json`'s `cloudflare[].authentication.api_token` together.
Restart the DDNS deployment after its Secret reflects the new credential;
both updater instances read credentials at startup.

The updater preserves existing records when address detection fails. A
published AAAA record alone therefore does not establish current IPv6
connectivity. IPv4-only services must use the IPv4-only target.

## Related

- [Homelab networking](/explanation/homelab/overview/)
