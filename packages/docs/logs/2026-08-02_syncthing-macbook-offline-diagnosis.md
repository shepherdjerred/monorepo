---
id: syncthing-macbook-offline-diagnosis
type: log
status: complete
board: false
---

# Syncthing "Running (Offline)" on MacBook — diagnosis

## Symptom

Syncthing menu bar on the MacBook showed **"Running (Offline)"** (screenshot at 16:55, Sun Aug 2).

## Root cause

Syncthing **auto-upgraded to v2.1.2 "Hafnium Hornet"** at 16:56 today. v2 replaced the
on-disk database (LevelDB → SQLite), so first launch runs a **one-time database
migration**. During migration Syncthing starts only a _temporary_ GUI/API and cannot
connect to peers — hence the transient "Offline" status. This is expected, not a fault.

Evidence (`~/Library/Application Support/Syncthing/syncthing.log`):

```
16:56:03  syncthing v2.1.2 "Hafnium Hornet" (go1.26.5 darwin-arm64) started
16:56:04  Archiving a copy of old config file format (config.xml.v51)
16:56:11  Starting temporary GUI/API during migration
16:56:12  Applying database migration … script=06-zero-size-dirs.sql
16:58:17  Completed initial scan (Steam Deck Saves)
16:58:31  Completed initial scan (Sync)
16:58:29  New external port opened (NAT-PMP@192.168.1.1)
```

The REST API (`/rest/system/error`) returned `*** Database migration in progress ***`
during the window, then resumed normal JSON once complete.

## State after migration

- API healthy again; `myID` = FYBLBN3…, `discoveryMethods: 5`.
- Only IPv6 discovery methods erroring (`IPv6 local`, `discovery-announce-v6`) — normal
  on a network without IPv6.
- 5 folders (Sync, Steam Deck Saves, MM Saves, OOT Saves, + one) re-scanned OK.
- Network changed vs June: gateway now `192.168.1.1` (was `192.168.50.1`); NAT type
  now reported **Symmetric NAT** → peer links will go via relay, not direct.

## Remaining

- Sole peer `GWUQHQ3` = **"torvalds"** still `connected: false` immediately post-migration.
  Either (a) needs a minute to discover + relay-connect, or (b) torvalds itself is
  offline / also mid-migration (it was on v2.1.0). If it doesn't reconnect within a
  couple minutes, verify torvalds is powered on and reachable — that's the remaining
  variable, the MacBook side is healthy.

## Diagnostic commands used

```bash
# API key from config, then:
API=<apikey>; H="X-API-Key: $API"; B=http://127.0.0.1:8384
curl -s -H "$H" "$B/rest/system/status"
curl -s -H "$H" "$B/rest/system/connections"
curl -s -H "$H" "$B/rest/system/error"
tail -f ~/Library/Application\ Support/Syncthing/syncthing.log
```

## Session Log — 2026-08-02

### Done

- Diagnosed MacBook Syncthing "Running (Offline)": transient v1→v2.1.2 SQLite database
  migration (completed ~16:58). Confirmed API recovered, folders re-scanned, discovery
  and NAT port working.

### Remaining

- Peer "torvalds" (GWUQHQ3) not yet reconnected at time of diagnosis; expected to relay-
  connect shortly. If not, check torvalds is online.

### Caveats

- MacBook is on a new network (Symmetric NAT) — peer connections rely on relays, which
  is fine but slower to establish than direct.
