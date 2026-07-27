---
id: homekit-secure-video
type: todo
status: complete
board: false
origin: packages/docs/logs/2026-06-13_new-todos-batch.md
source_marker: false
---

# HomeKit Secure Video — remaining steps

## Where it stands (2026-06-26)

| Piece                             | State                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Scrypted deployed + healthy       | ✅ pod `home-scrypted-*` Running, ArgoCD `home` Synced/Healthy                                 |
| Tailnet console URL               | ✅ `https://scrypted.tailnet-1a49.ts.net/` works (PR #1320 — ingress now targets HTTP `11080`) |
| Admin account                     | ✅ created (`hasLogin: true`)                                                                  |
| Reolink doorbell added            | ✅ `192.168.1.199`, **live stream working** (RTSP h264)                                        |
| Motion detection                  | ✅ firing (`motionDetected` events)                                                            |
| `@scrypted/homekit` plugin        | ✅ installed                                                                                   |
| HA duplicate HomeKit accessory    | ✅ removed (PR #1321) — `21065` + Front Door block gone, ArgoCD synced                         |
| **HomeKit pairing in Apple Home** | ❌ **not done — the remaining blocker**                                                        |
| Stream & Allow Recording (HKSV)   | ❌ pending pairing                                                                             |

> ⚠️ **Current gap:** because PR #1321 deployed before pairing, the doorbell is **not in
> HomeKit at all right now** (HA's accessory removed, Scrypted's not yet paired). This is
> expected and harmless — the doorbell still works in HA. HomeKit returns once paired.

## The blocker: why pairing needs the Seattle LAN

HomeKit pairing requires the device running Apple Home to **mDNS/Bonjour-discover** the
accessory on the **local network**, then pair over HAP. The QR/setup code does **not**
contain the accessory's IP — the Home app gets it only from the mDNS announcement. So:

- A `kubectl port-forward` / Tailscale tunnel carries unicast TCP (HAP) but **not** the
  multicast mDNS discovery. Tailscale is L3 → no multicast → the iPhone never sees the
  announcement, and there is no "pair by IP" option.
- The Home Hub enables remote access to **already-paired** accessories; it does **not**
  enable remote **pairing**.

The device doing the pairing doesn't have to be the phone in hand — it just has to be an
Apple device **physically on the Seattle LAN**.

## Off-LAN pairing options (pick one)

1. **Remote into a Mac at home** (cleanest if one exists). Screen-share/VNC into a Mac on
   the home LAN (over Tailscale) → `Home.app` → Add Accessory → enter the Scrypted setup
   code. That Mac is local to the doorbell, so mDNS works; you drive it from Atlanta.
2. **Someone at the house** pairs on a device signed into the owner's Apple ID + HomeKit home.
3. **L2-bridge VPN** (ZeroTier/tap-mode) to put the Atlanta iPhone on the home broadcast
   domain. Only "direct from your phone" option, but heavy setup + iOS multicast-over-VPN
   is flaky. Not recommended for a one-time pairing.
4. **Wait until back in Seattle** — ~2-minute job on home Wi-Fi.

## Closure

The camera was paired and operating through Scrypted HKSV. It was accidentally
removed and successfully re-paired on 2026-07-09. Post-re-pair recording and
notification checks are tracked by
`packages/docs/todos/homekit-secure-video-post-repair-verification.md`.

## Cleanup

- The temporary `cam-proxy` pod + its `:8443` tunnel were already torn down.
- The `kubectl port-forward … svc/scrypted 10443` is now **redundant** (tailnet URL works) —
  kill it and use `https://scrypted.tailnet-1a49.ts.net/` instead.

## Verification (HKSV working end-to-end)

- Trigger motion at the door → a clip appears in the Home app's camera timeline.
- A rich notification fires ("Front Door — A person is detected") for a person.
- Live view loads remotely (proves Home Hub remote access).
- `kubectl logs -n home <scrypted-pod>` shows the RTSP rebroadcast active with HAP clients.

## Reference (facts established this session)

- **Camera:** Reolink Video Doorbell WiFi, `192.168.1.199`. Admin creds live in HA's Reolink
  config entry (also belong in the homelab 1Password vault — do not commit them).
- **Root cause of the blank preview:** the camera had **HTTPS-only** (HTTP disabled), which
  302-redirects the Reolink HTTP API → the plugin got HTML instead of JSON and fell back to
  RTMP (which was also off). Fix: enable **HTTP** on the camera (kept HTTPS **on** so HA's
  HTTPS:443 integration is untouched), and enable RTMP. Final camera Server Settings:
  `http=1, https=1, rtmp=1, rtsp=1, onvif=1`. See the Scrypted Reolink plugin README:
  the plugin requires HTTP reachable (it normally wants HTTPS _disabled_, but HTTP-enabled
  alongside HTTPS works because HTTP then serves the API without redirecting).
- **Scrypted plugins:** core, homekit, prebuffer-mixin, reolink, snapshot, webrtc. No NVR /
  objectdetector / GPU — HKSV records to iCloud; Apple classifies clips on the Home Hub.
- **HA:** Reolink integration + `camera.front_door_fluent` + person/visitor/motion sensors +
  chime all remain. Only the HA→HomeKit bridge for this camera was removed.
- **Monitoring:** already covered by platform — Velero backs up `scrypted-pvc` (zfs→R2),
  kube-prometheus default alerts cover pod down/crashloop/PVC-fill. Optional extras (blackbox
  probe on the Scrypted service; HA camera-offline alert) deferred, not required.

## Comment Log

- 2026-07-27 — Board audit verified the 2026-07-09 HomeKit exposure audit and
  incident log record successful pairing/re-pairing. Closed this original setup
  card and left only the newer consolidated refresh follow-up for residual live
  verification.
