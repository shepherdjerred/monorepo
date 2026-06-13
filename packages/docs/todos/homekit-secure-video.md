---
id: homekit-secure-video
status: active
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# Get HomeKit Secure Video working end-to-end (Scrypted + Home Assistant)

## What

HomeKit Secure Video (HKSV) is not configured today. Get cameras recording to
iCloud via HKSV with motion/person events, end-to-end.

Current state:

- **Scrypted** deployed at
  `packages/homelab/src/cdk8s/src/resources/home/scrypted.ts`
  (`ghcr.io/koush/scrypted`, `hostNetwork: true` for mDNS/HAP, single replica,
  8 GB ZFS state volume, Tailscale ingress). LAN ingress policies in
  `src/cdk8s/src/cdk8s-charts/home.ts`.
- **Home Assistant HomeKit bridges** in
  `packages/homelab/src/cdk8s/config/homeassistant/configuration.yaml`: HA1
  (`:21063`), HA2 lights (`:21064`), and a front-door **accessory** bridge
  (`:21065`) with `support_audio`, `video_codec: copy`, linked motion
  (`binary_sensor.front_door_person`) and doorbell
  (`binary_sensor.front_door_visitor`) sensors.
- Today this is **basic HomeKit streaming only** — no HKSV recording. HKSV
  requires a Home Hub (HomePod/Apple TV) + iCloud+ and the camera exposed
  through Scrypted's HomeKit plugin in HKSV mode.

## Done when

- Cameras expose HKSV through Scrypted, recording to iCloud with motion/person
  event clips.
- Verified end-to-end on an Apple device: recordings appear in the Home app and
  rich (person/doorbell) notifications fire.

## Open decisions

- Whether to drive HKSV via Scrypted directly or via HA's HomeKit camera
  integration (avoid double-bridging the same camera).
- Home Hub + iCloud+ prerequisites confirmed.
