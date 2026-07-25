---
id: log-2026-05-31-homekit-secure-video
type: log
status: complete
board: false
---

# HomeKit Secure Video

## Context

Home Assistant currently exposes the Reolink front door camera through the YAML HomeKit integration as an accessory:

- `camera.front_door_fluent`
- `binary_sensor.front_door_person`
- `binary_sensor.front_door_visitor`
- `switch.front_door_record_audio`

Live Home Assistant registry inspection showed these relevant devices:

| Device                      | Platform      | Model                       | Relevant state                                                                                   |
| --------------------------- | ------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| Front Door                  | Reolink       | Reolink Video Doorbell WiFi | `camera.front_door_fluent` enabled, clear stream disabled, visitor/person/motion sensors enabled |
| Reolink Chime               | Reolink       | Reolink Chime               | Visitor ringtone configured, chime controls available                                            |
| Front Door                  | Eufy Security | T8510P                      | Lock and battery entities; not the camera path for HKSV                                          |
| Granary Smart Camera Feeder | Petlibro      | PLAF203                     | Video recording metadata exists, but no HA `camera.*` entity                                     |

Home Assistant's HomeKit Bridge still does not provide HomeKit Secure Video. Scrypted does provide HomeKit Secure Video for imported cameras, with each camera paired as its own HomeKit accessory.

## Implementation Notes

- Added Scrypted to the existing `home` chart rather than a new namespace because it is part of the Home Assistant/camera stack and needs LAN/HomeKit adjacency.
- Used `hostNetwork` because Scrypted's Docker/HomeKit guidance requires host networking for mDNS and same-subnet Home Hub traffic.
- Persisted Scrypted state under `/server/volume` on an 8 GiB `ZfsNvmeVolume`.
- Exposed the management console at `https://scrypted.tailnet-1a49.ts.net` via Tailscale ingress.
- Pinned `ghcr.io/koush/scrypted:v0.144.1-noble-full` by digest.
- Added port `21065` to the existing LAN HomeKit allow-list because the current HA `Front Door` accessory uses that port but the NetworkPolicy only allowed HA1/HA2 ports.

## Remaining Setup

After ArgoCD deploys the chart:

1. Open `https://scrypted.tailnet-1a49.ts.net`.
2. Create the Scrypted admin account.
3. Install the Reolink and HomeKit plugins.
4. Add the Reolink Video Doorbell directly to Scrypted.
5. Verify the camera stream and motion sensor in Scrypted.
6. Pair the Scrypted camera accessory in Apple Home.
7. In Apple Home, enable `Stream and Recording` for the camera.
8. After HKSV works, remove or unpair the duplicate HA `Front Door` HomeKit accessory to avoid two HomeKit entries for one doorbell.

## Session Log - 2026-05-31

### Done

- Queried live HA state and registries for camera/doorbell-related devices.
- Confirmed HA currently has one usable camera entity for HKSV work: `camera.front_door_fluent` from the Reolink Video Doorbell WiFi.
- Confirmed HA's existing HomeKit accessory path can do live camera/doorbell behavior but not HKSV.
- Added `packages/homelab/src/cdk8s/src/resources/home/scrypted.ts`.
- Wired Scrypted into `packages/homelab/src/cdk8s/src/cdk8s-charts/home.ts`.
- Pinned the Scrypted image in `packages/homelab/src/cdk8s/src/versions.ts`.
- Added the missing `21065/TCP` LAN allow-list entry for the existing HA Front Door HomeKit accessory.
- Verified `bun run --filter='./packages/homelab' typecheck`.
- Verified `bun run --filter='./packages/homelab' lint`.
- Verified `bun run --filter='./packages/homelab' test`.
- Checked the rendered home chart contains the Scrypted deployment, PVC, Tailscale ingress, host networking, and the `21065/TCP` NetworkPolicy entry.
- Checked the live `torvalds` node is `amd64`, matching the pinned Scrypted image manifest architecture.

### Remaining

- Deploy via the normal ArgoCD flow.
- Configure Scrypted manually with the Reolink and HomeKit plugins.
- Pair the Scrypted camera in Apple Home and enable `Stream and Recording`.
- Decide whether to remove the existing HA Front Door HomeKit accessory once HKSV is confirmed.

### Caveats

- I did not extract or display camera credentials.
- Scrypted plugin and Apple Home pairing state are application/runtime state, not fully represented in CDK8s.
- The Petlibro/Granary feeder exposes video metadata in HA but no `camera.*` entity, so it is not a ready HKSV candidate from the current HA view.

## Session Log - 2026-06-02

### Done

- Added `scrypted-lan-ingress-policy` in `packages/homelab/src/cdk8s/src/cdk8s-charts/home.ts` so LAN Home Hubs can reach Scrypted's runtime-allocated HomeKit/HAP accessory ports.
- Kept the broader LAN ingress allowance scoped to pods labeled `app=scrypted`; the existing HA bridge rule remains limited to mDNS plus HA ports `21063-21065`.
- Verified `bun run --filter='./packages/homelab' typecheck`.
- Verified `bun run --filter='./packages/homelab' lint`.
- Verified `bun run --filter='./packages/homelab' test`.
- Checked the rendered home chart contains `scrypted-lan-ingress-policy` scoped to `app=scrypted`.
- Addressed the Greptile P2 review by removing `SCRYPTED_DOCKER_AVAHI=true`, avoiding a second Avahi daemon binding mDNS on the host-network namespace.
- Re-verified `bun run --filter='./packages/homelab' typecheck`, `lint`, and `test`; the rendered Scrypted deployment now has no `SCRYPTED_DOCKER_AVAHI` env var.
- Fixed Buildkite build `3219`'s hard `:art: Prettier` failure by formatting the two files reported in the job log.
- Verified the CI formatting fix with `bash .buildkite/scripts/prettier.sh`.

### Remaining

- None for this follow-up.

### Caveats

- Scrypted runtime/plugin setup and Apple Home pairing are still manual post-deploy steps.
