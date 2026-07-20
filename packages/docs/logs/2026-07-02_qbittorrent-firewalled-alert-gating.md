---
id: log-2026-07-02-qbittorrent-firewalled-alert-gating
type: log
status: complete
board: false
---

# qBittorrent "firewalled" PagerDuty alert — root cause & gating fix

## Context

PagerDuty incident #5888 (`Q005AP7ARSNZHW`) — "qBittorrent is firewalled (media)" —
fired 2026-07-02 17:30. Investigated as one of the open PD incidents on the Homelab
service.

## Investigation

Live cluster state for `media-qbittorrent-*` (gluetun + qbittorrent + qbittorrent-exporter):

- `qbittorrent_firewalled == 1`, `qbittorrent_dht_nodes == 0`, **0 torrents** in the client.
- gluetun tunnel healthy: wg0 `10.154.174.240/32`, public exit IP a real AirVPN address.
- qBittorrent listening on `wg0:17826` (TCP+UDP), `Session\Port=17826`, UPnP off.
- Config-as-code (`resources/torrents/qbittorrent.ts`) internally consistent:
  `FIREWALL_VPN_INPUT_PORTS=17826` == qBittorrent `Session\Port`. Static
  `WIREGUARD_ADDRESSES` matches live wg0.
- Outbound egress through the tunnel works (`curl ipinfo.io/ip` → VPN exit IP).
- **Inbound port genuinely reachable**: `nc -vz <exit-ip> 17826` from outside **succeeded**.

### Root cause

Nothing was broken. qBittorrent only clears its "firewalled" status once it **receives
an incoming peer connection**. With **zero torrents loaded**, nothing ever drives an
inbound connection, so the status stays stuck at firewalled even though the forwarded
port is open and reachable. The `nc` probe from outside acted as that inbound connection
and flipped `qbittorrent_firewalled` to `0` live. A pod restart does not fix it (it stayed
firewalled for ~8 min post-restart into the empty client) — it's a false positive on an
idle/empty client, recurring on every restart-into-empty-client.

## Fix

`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/qbittorrent.ts` —
gate the `QBitTorrentFirewalled` alert on having ≥1 torrent:

```
qbittorrent_firewalled == 1 and on(server) (sum by (server) (qbittorrent_torrents_count)) > 0
```

Validated against live Prometheus (`prometheus-kube-prometheus-prometheus`, port-forwarded):

- Both `qbittorrent_firewalled` and `qbittorrent_torrents_count` carry the `server` label,
  so `and on(server)` joins cleanly.
- With 0 torrents, the gated expression returns **0 results** → no alert. ✅

`for: 5m` and `severity: warning` left unchanged (only the gating was requested).

## Verification

- `bun run typecheck` (homelab cdk8s + helm-types) — passes.
- `bunx eslint qbittorrent.ts` — clean.
- PromQL semantics validated against live Prometheus (above).

## Session Log — 2026-07-02

### Done

- Diagnosed PD #5888 end-to-end: false-positive firewalled alert on an idle qBittorrent
  (0 torrents); forwarded port 17826 proven open via external `nc`. Restarted the
  deployment (`media-qbittorrent`); metric cleared to 0 after an external probe.
- Gated the `QBitTorrentFirewalled` Prometheus rule on `sum by (server)
(qbittorrent_torrents_count) > 0`; validated the query against live Prometheus.
- Typecheck + lint pass. PR opened from `feature/qbit-firewalled-gate`.

### Remaining

- PD #5881 (Scout weekly COMMON_DENOMINATOR reports "not fired", the epoch-0 / "20636d"
  alert) still open and un-investigated beyond root-cause identification: one or more of
  report ids 74–84 has no `ReportRun` with `trigger=SCHEDULED,status=SUCCESS`, so
  `schedule-metric-seed.ts` seeds the gauge to 0. Next step: query scout-prod `ReportRun`
  history to distinguish "never fired" vs "every scheduled run failing".
- PD #5877 / #5880 (R2 bucket over 1.5TB) untouched.

### Caveats

- The alert now stays silent whenever the client is idle with 0 torrents — acceptable per
  request, but it means a genuinely-firewalled _and_ empty client won't page (there'd be
  nothing to download anyway).
- Restarting an empty qBittorrent will still momentarily show `firewalled=1` until real
  torrent traffic arrives; the gate is what prevents that from paging.
