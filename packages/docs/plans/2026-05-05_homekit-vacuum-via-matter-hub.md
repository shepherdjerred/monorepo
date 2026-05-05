# HomeKit Vacuum Support via Matter Hub

Add `home-assistant-matter-hub` (HAMH) to the cluster so HA `vacuum.*` entities (Roomba, Roborock, Dreame, etc.) appear as native robot vacuums in Apple Home.

## Status

**Not started.** Proposed; no hardware ordered, no PR open.

## Why this and not the HomeKit Bridge

| Path                                             | Works? | Why                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HA `homekit` integration (HAP bridge)            | ❌     | HomeKit Accessory Protocol has no `RobotVacuumCleaner` service. The "vacuum support" Apple shipped in iOS 18.4 is a **Matter 1.4** device type, not an HAP service. HA maintainers have explicitly declined to add it (`home-assistant/discussions#3121`). |
| `python-matter-server` (HA `matter` integration) | ❌     | That's a Matter _controller_ — it pairs HA _to_ Matter devices, not the other way around.                                                                                                                                                                  |
| HAMH (`t0bst4r/home-assistant-matter-hub`)       | ✅     | Acts as a Matter _bridge_: reads HA state via WS API, advertises HA entities as Matter accessories on the LAN, including `RoboticVacuumCleaner`. Apple Home commissions it like any Matter device.                                                         |

## What gets deployed

Single `home-assistant-matter-hub` Deployment in the `home` namespace. Reads from the existing HA service over its WS API; advertises Matter-over-IP on the LAN.

Image: `ghcr.io/t0bst4r/home-assistant-matter-hub` (pin sha256 in `versions.ts`).

### Required runtime constraints (non-negotiable, all from upstream docs)

- **Host networking.** Matter commissioning relies on mDNS + IPv6 link-local. Pod must run with `hostNetwork: true` (same pattern as `homeassistant.ts:170-172`). No userland Matter relay works without it.
- **IPv6 enabled** on the node's pod network. Talos has IPv6 on by default; verify with `talosctl get addresses` before deploying.
- **Persistent volume at `/data`.** Stores Matter fabric/commissioning state per bridge — losing this re-pairs every device. Use `ZfsNvmeVolume` like `homeassistant-pvc` (`homeassistant.ts:46-48`); ~1 GiB is plenty.
- **Apple home hubs on iOS/tvOS/audioOS 18.4+.** A single sub-18.4 hub in the Home will cause the vacuum accessory to silently not appear. Verify before bring-up; this is the single most common bring-up failure in upstream issues.

### Per-vacuum: Server Mode bridge

HAMH supports two modes:

- **Aggregator mode** (default): one bridge holds many entities. _Cannot_ contain an `RVC` device — Apple Home crashes on commissioning. Use this for non-vacuum entities only.
- **Server Mode**: one bridge = one device = one QR code = one Matter fabric. Required for vacuums.

So _N_ vacuums = _N_ Server Mode bridges = _N_ unique ports. HAMH UI handles bridge creation; nothing is in cdk8s code.

## Implementation checklist

Follows the homelab "Adding New Services" pattern (`packages/homelab/CLAUDE.md:88-104`).

| Step                                        | File                                                                             | Mirror                          |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| 1. cdk8s resource                           | `src/cdk8s/src/resources/home/matter-hub.ts` (new)                               | `resources/home/zwave-js-ui.ts` |
| 2. Wire into `home` chart                   | `src/cdk8s/src/cdk8s-charts/home.ts`                                             | sibling to HA + zwave-js-ui     |
| 3. PVC at `/data`                           | uses `ZfsNvmeVolume`                                                             | `homeassistant.ts:46-48`        |
| 4. Helm chart dir                           | `src/cdk8s/helm/matter-hub/Chart.yaml`                                           | any existing chart              |
| 5. CI catalog entry                         | `scripts/ci/src/catalog.ts` (`HELM_CHARTS`)                                      | —                               |
| 6. ArgoCD app                               | `src/cdk8s/src/resources/argo-applications/matter-hub.ts`                        | any existing app                |
| 7. Image version                            | `src/cdk8s/src/versions.ts` (`t0bst4r/home-assistant-matter-hub`, pinned sha256) | —                               |
| 8. 1Password item                           | new item: HA long-lived access token for HAMH                                    | vault `Homelab (Kubernetes)`    |
| 9. TailscaleIngress to HAMH UI port `:8482` | `resources/home/matter-hub.ts`                                                   | `zwave-js-ui.ts`                |

Env vars on the container:

```
HAMH_HOME_ASSISTANT_URL=http://homeassistant-service.home.svc.cluster.local:8123
HAMH_HOME_ASSISTANT_ACCESS_TOKEN=<from 1Password>
HAMH_HTTP_PORT=8482
HAMH_LOG_LEVEL=info
```

## Per-vacuum bring-up (post-deploy, repeat per device)

Prerequisite: the vacuum's HA integration is already working — `vacuum.<name>` entity responds to `start` / `return_to_base` from HA itself.

1. HAMH UI (`http://matter-hub:8482` over Tailscale) → New Bridge wizard.
2. Check **Server Mode**.
3. Filter: single entity, `vacuum.<name>`.
4. Assign a unique port (start at `5540` and increment).
5. Save → bridge starts → QR code appears in the Devices panel.
6. Apple Home → Add Accessory → scan QR → accept "Uncertified" warning → assign room.
7. Verify with Siri: `Hey Siri, start the <room> vacuum`.

~2 minutes per vacuum after the first one.

## Risks / known unknowns

- **Host-network port collisions.** HA already runs `hostNetwork: true` on the same node. HAMH default UI port `8482` is unused; per-vacuum Matter ports (`5540+`) need to stay clear of anything else on the host. Document the reserved range in the cdk8s file.
- **Talos + Matter mDNS.** `cdc-acm`/USB-serial gotchas don't apply here, but Talos's CNI must allow IPv6 multicast on the host interface. Verify with `socat -u UDP6-RECV:5353,reuseaddr -` on the node before pairing fails mysteriously.
- **HAMH stability.** Single-maintainer project (`t0bst4r`). Treat the image tag as load-bearing; keep `versions.ts` pinned to a sha256, not `:latest`. Watch the GitHub repo for breaking-change releases via Renovate.
- **Apple aggregator-RVC bug.** "One vacuum per bridge" exists because Apple Home crashes if an `RVC` device sits inside a Matter aggregator — not because HAMH requires it. If Apple ever fixes this, we can collapse to a single bridge; until then, the per-vacuum overhead is real.
- **Re-pair on PV loss.** Losing the HAMH PVC = re-scanning every QR code in Apple Home. Velero backup of the PVC is sufficient; no special handling needed beyond the standard `home`-namespace backup schedule.
- **No vacuum yet.** This plan is only useful once an HA vacuum integration is in place. If/when the user adds a Roborock/Roomba, this plan unblocks Apple Home support; otherwise it's dormant infra.

## References

- HAMH docs: https://t0bst4r.github.io/home-assistant-matter-hub/
- Server Mode rationale (Apple aggregator crash): https://github.com/t0bst4r/home-assistant-matter-hub/issues/642
- HA HomeKit Bridge vacuum decision: https://github.com/orgs/home-assistant/discussions/3121
- HA community feature request thread: https://community.home-assistant.io/t/homekit-vacuum-entity-support/771548
