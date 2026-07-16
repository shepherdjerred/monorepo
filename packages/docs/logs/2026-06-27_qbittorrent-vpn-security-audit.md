# qBittorrent + VPN (gluetun/AirVPN) Security Audit

## Status

Complete (audit only — no code changes)

## Scope

Security review of the qBittorrent-over-VPN deployment, with a specific focus on
**IP-leak risk**. Code: `packages/homelab/src/cdk8s/src/resources/torrents/qbittorrent.ts`
(wired into the `media` chart at `cdk8s-charts/media.ts:59`). Audit included **live
inspection** of the running pod `media-qbittorrent-77dd858f5c-vv96n` (node `torvalds`,
pod IP `10.244.0.66`).

## Architecture

Single Deployment, 3 containers in one pod (shared netns):

- `gluetun` (`ghcr.io/qdm12/gluetun`) — **privileged**, AirVPN over WireGuard (`wg0`).
- `qbittorrent` (`ghcr.io/linuxserver/qbittorrent`) — web UI :8080, `/config` (ZFS-NVMe 32Gi), `/downloads` (shared ZFS-SATA 1Ti).
- `qbittorrent-exporter` — Prometheus metrics :17871 (hardened: nobody/65534, ro-rootfs).

## IP-Leak Verdict: **No leak in steady state — fail-closed, verified live**

Four independent layers, all confirmed on the live pod:

1. **Policy routing** (v4+v6): `ip rule` `from all fwmark 0xca6c lookup 51820`; table
   `51820` = `default dev wg0`. gluetun marks app traffic so it routes out the tunnel.
2. **Firewall kill switch** — `iptables`/`ip6tables` OUTPUT policy is **DROP**. Only
   allowed out `eth0`: `lo`, established/related, pod-LAN `10.244.0.0/24`, and the VPN
   server endpoint `213.152.162.73:1637/udp`. **Everything else only via `wg0`.** If the
   tunnel drops, public traffic is dropped, not leaked (fail-closed). Same shape for v6
   (only link-local via eth0).
3. **qBittorrent bound to the VPN interface** — `Session\Interface=wg0`,
   `Session\InterfaceName=wg0` in `/config/qBittorrent/qBittorrent.conf`. App-level
   fail-closed: it won't send torrent traffic on any other interface.
4. **UPnP disabled** (`Connection\UPnP=false`) — no port-mapping attempts on the LAN gateway.

**Empirical proof (live):**

- qBittorrent IPv4 egress = `213.152.162.74` (RDAP `NL-AIR` = AirVPN), matches gluetun's
  reported VPN IP, confirmed via api.ipify.org / ifconfig.me / icanhazip.com.
- qBittorrent IPv6 egress = `2a00:1678:2470:28:…` (RDAP `NL-GLOBALLAYER`, `2a00:1678::/32`,
  AS49453 — AirVPN's NL host). Pod `eth0` has **no global IPv6** (only `fe80` link-local),
  so the only globally-routable v6 interface in the netns is `wg0` → v6 is tunnelled.
- DNS: `resolv.conf` = `1.1.1.1`. A query to `1.1.1.1` can only exit via `wg0` per the
  firewall (eth0→1.1.1.1 hits OUTPUT DROP) → DNS is tunnelled, no DNS leak.
- Port-forward consistent end-to-end: manifest `FIREWALL_VPN_INPUT_PORTS=17826` ==
  `Session\Port=17826` == iptables `INPUT -i wg0 --dport 17826 ACCEPT`.

**Residual leak windows (small, require multiple simultaneous failures):**

- gluetun process restart briefly flushes/rebuilds iptables. Restart history shows gluetun
  _did_ restart (exitCode 1) on 2026-06-26 while qBittorrent kept running ~15 min, so this
  window is real and has occurred. Mitigated by the `wg0` interface binding (app won't use
  eth0). A leak would need: firewall rules absent during flush **and** binding lost **and**
  traffic in flight.
- The two strongest layers (wg0 binding + UPnP-off) live in the `/config` **PVC = mutable
  runtime state, not IaC**. A config reset / PVC wipe / qBittorrent reinstall could silently
  drop them, leaving only firewall+routing (still fail-closed, but one fewer layer). Not monitored.

## General Security Findings

| #   | Sev  | Finding                                                                                                                                                                                                                                                                         | Fix                                                                                                                                                                                            |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | High | `gluetun` runs `privileged: true` + `allowPrivilegeEscalation`. Container escape → Talos node compromise; same namespace as publicly-exposed Plex/Jellyfin/Seerr.                                                                                                               | Drop privileged; add cap `NET_ADMIN` + mount `/dev/net/tun` + sysctl `net.ipv4.conf.all.src_valid_mark=1` (standard non-privileged gluetun). TODO at `qbittorrent.ts:72` already acknowledges. |
| M1  | Med  | No liveness/readiness probe on gluetun **and** gluetun is BestEffort QoS (no requests/limits) → first to be OOM-evicted, wedged tunnel not auto-recovered.                                                                                                                      | Give gluetun small resource requests (≠ BestEffort) + liveness probe via control server (`:8000/v1/openvpn/status`).                                                                           |
| M2  | Med  | Monitoring gap: `QBitTorrentFirewalled` alert (metric `qbittorrent_firewalled` **verified live = 0**, alert is valid) only catches a broken **port-forward**. A **tunnel-down** event shows as `qbittorrent_connected == 0`, which has **no alert** → silent download stoppage. | Add alert on `qbittorrent_connected == 0 for 10m` (rules at `resources/monitoring/monitoring/rules/qbittorrent.ts`).                                                                           |
| L1  | Low  | WireGuard private/preshared keys via env vars (readable in `/proc/1/environ`, `kubectl describe`).                                                                                                                                                                              | Optional: gluetun `WIREGUARD_PRIVATE_KEY_SECRETFILE` / `*_SECRETFILE`.                                                                                                                         |
| L2  | Low  | Strongest leak protections (wg0 binding, UPnP-off) are PVC runtime state, not IaC/monitored.                                                                                                                                                                                    | Document; consider a check/alert if exporter exposes interface info.                                                                                                                           |
| L3  | Low  | 1Password item named `mullvad` actually holds AirVPN creds (`qbittorrent.ts:30`).                                                                                                                                                                                               | Rename for clarity.                                                                                                                                                                            |
| L4  | Info | No egress NetworkPolicy (`policyTypes: ["Ingress"]`).                                                                                                                                                                                                                           | Not a real gap (can't enforce VPN intra-pod); the in-netns firewall is the correct layer.                                                                                                      |

**Positives worth noting:** fail-closed kill switch on both v4 and v6; qBittorrent bound to
`wg0` (the belt-and-suspenders most setups skip); UPnP off; port-forward consistent across
manifest/firewall/app; exporter hardened; the firewalled-alert metric exists and is wired correctly.

## Session Log — 2026-06-27

### Done

- Read deployment + supporting code (`qbittorrent.ts`, `linux-server.ts`, `tailscale.ts`,
  `media.ts`, monitoring rule, Talos network patches).
- Confirmed pod network is IPv4-only (Talos default flannel; no dual-stack/IPv6 in patches).
- Live-inspected pod `media-qbittorrent-77dd858f5c-vv96n`: interfaces, `ip rule`, all route
  tables, `iptables`/`ip6tables`, qBittorrent.conf, dnsConfig, restart history.
- Verified actual public egress (v4 + v6) is AirVPN via RDAP; verified `qbittorrent_firewalled`
  metric exists (=0).

### Remaining

- Implement fixes H1/M1/M2 (separate PR). H1 (drop gluetun privilege) is the headline item.

### Caveats

- Audit was read-only; no manifests changed. Live exec calls were all non-disruptive
  (no tunnel drop test in prod).
- The `wg0` interface binding lives in the `/config` PVC, not in git — re-verify after any
  qBittorrent config reset.
