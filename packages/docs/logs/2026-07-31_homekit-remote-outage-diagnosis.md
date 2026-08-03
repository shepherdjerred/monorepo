---
id: homekit-remote-outage-diagnosis
type: log
status: complete
board: false
---

# HomeKit Remote Outage Diagnosis — 2026-07-31

Q&A/diagnosis session: "why does my HomeKit not seem to work? HA is up." User was
away from home, expecting remote control via their Apple TV home hub.

## Findings

Verified in order, from the Mac (remote network) and from inside the HA pod
(hostNetwork on torvalds, home LAN `192.168.1.0/24`):

1. **HA healthy.** `home-homeassistant` pod Running; HomeKit bridge logs clean
   (one benign `lock.front_door` accessory-mode warning).
2. **Bridges healthy.** HA1 + HA2 both paired (2 clients each in
   `/config/.storage/homekit.*.state`), advertising `_hap._tcp` on
   `192.168.1.81`, listening on 21063 (`LISTEN` confirmed via `/proc/net/tcp`).
3. **Root cause: no home hub connected.** Zero established TCP sessions to
   21063 — a working hub holds a persistent event-subscription connection.
4. **Both HomeKit hubs (Apple TV + the single HomePod) are off the home
   network.** mDNS browses plus a full `192.168.1.1–254` TCP scan found only
   four AirPlay devices — all **Sonos** (Five/.227, One/.40, Era 100/.11,
   One/.73; identified via AirPlay `GET /info` model field), NOT HomePods.
   No Apple device answered anywhere on the LAN.
5. **Timeline from the recorder DB** (ASUS router device trackers, Apple OUI
   `64:d2:c4`): device "Living-Room" (`…:b9:fc:1d`) off network since
   ≥2026-07-27; device "Apple" (`…:b2:6a:c7`) was home until **2026-07-30
   11:53 PT**, flapped for a few minutes, dropped at ~11:55 and never
   returned. That drop is when HomeKit remote control died.
6. Everything else on the LAN is healthy: ASUS RT-AX88U Pro router (.1), five
   Sonos units, Hue bridge (.49), ~16 live hosts total. Not a whole-network
   outage — specifically the two Apple devices (both living-room; a shared
   power strip/outlet is a plausible single cause).

Secondary, unrelated: the user's current remote network (`192.168.20.0/22`)
firewalls direct traffic to `192.168.1.81` ("communication prohibited by
filter" from `10.128.128.128`) — only relevant to local control, not the hub
path.

## Recommended actions (user-side, no repo changes)

1. Someone at home checks power to the living-room Apple TV and HomePod
   (likely a shared power strip/outlet, given both are living-room devices and
   one had been down for days before the second dropped Jul 30 ~11:55 PT).
2. Home app → Home Settings → Home Hubs & Bridges will confirm hub status.
3. Once either hub rejoins the network, it should reconnect to the HA bridges
   automatically (verified server-side ready: paired, advertising, port open).

## Session Log — 2026-07-31

### Done

- Diagnosed HomeKit remote-control outage end-to-end. Root cause: BOTH
  hub-capable devices (Apple TV + sole HomePod, both living-room) are off the
  home network; the last one dropped 2026-07-30 ~11:55 PT (recorder DB, router
  tracking). HA/bridges verified fully healthy. No code or infra changes.

### Remaining

- Someone at home restores power/network to the Apple TV / HomePod; nothing
  repo-side.

### Caveats

- AirPlay `_airplay._tcp` responders ≠ HomePods — the four responders were all
  Sonos; identify hardware via AirPlay `GET /info` (`model` field), never by
  service presence alone.
- Legacy-unicast mDNS probes are unreliable for Apple services other than
  `_airplay._tcp` — absence of a responder alone is not proof; the TCP scan is
  the conclusive check.
- `advertise_ip: 192.168.1.81` in `config/homeassistant/configuration.yaml`
  matches torvalds' live `eno1` address; if the home LAN is ever renumbered,
  this must be updated.
- `device_tracker.homepod` in HA is disabled (`disabled_by: integration`);
  the useful history lived in `device_tracker.living_room{,_2}` from the ASUS
  router integration.
