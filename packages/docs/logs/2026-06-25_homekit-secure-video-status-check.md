---
id: log-2026-06-25-homekit-secure-video-status-check
type: log
status: complete
board: false
---

# HomeKit Secure Video — Status Check

## Question

"What's left to do for getting HomeKit Secure Video on my homelab?"

## Findings (live verification 2026-06-25)

The split is clean: **all code/infra is merged and running; everything remaining is
manual runtime setup on an Apple device, none of it in the repo.**

### Done (shipped & live)

- Scrypted pod `home-scrypted-c94bd889f-b8zd2` Running/healthy (~3h22m at check time)
  on `torvalds`. Image `koush/scrypted:v0.144.1-noble-full`, `hostNetwork: true`,
  8 GiB ZFS state volume, Tailscale ingress `https://scrypted.tailnet-1a49.ts.net`.
  Source: `src/cdk8s/src/resources/home/scrypted.ts`, wired in
  `src/cdk8s/src/cdk8s-charts/home.ts`.
- NetworkPolicies: `scrypted-lan-ingress-policy` (LAN Home Hubs → runtime HAP ports)
  - `21065/TCP` allow-list for the HA Front Door accessory.
- HA HomeKit bridges in `config/homeassistant/configuration.yaml`: HA1 (`:21063`),
  HA2 lights (`:21064`), Front Door accessory (`:21065`, `mode: accessory`,
  `camera.front_door_fluent`, `support_audio`, `video_codec: copy`, `stream_count: 2`,
  linked motion `binary_sensor.front_door_person`, doorbell
  `binary_sensor.front_door_visitor`). This is **basic HomeKit streaming only — not HKSV.**

### Left to do (all manual, post-deploy)

1. Confirm prerequisites: LAN Home Hub (HomePod/Apple TV) + iCloud+ subscription.
2. Initialize Scrypted (admin account).
3. Install Reolink + HomeKit plugins.
4. Add the Reolink doorbell directly to Scrypted; verify stream + motion.
5. Pair the Scrypted camera accessory in Apple Home.
6. Enable _Stream & Recording_ (HKSV) in Apple Home.
7. Remove/unpair the duplicate HA Front Door accessory (`:21065`) once HKSV confirmed.
8. Verify end-to-end: clips in Home app + rich person/doorbell notifications.

### Open decisions

- Drive HKSV via Scrypted-direct (current lean, avoids double-bridging) vs HA's
  HomeKit camera integration.
- Reolink doorbell is the only ready HKSV candidate; Petlibro/Granary feeder has
  no HA `camera.*` entity.

## Caveat

Scrypted plugin/pairing state is app runtime behind the admin login — not visible
from CDK8s/kubectl. Could only confirm the pod is up and reachable, not whether
steps 2–5 are already done inside the console.

## Session Log — 2026-06-25

### Done

- Verified Scrypted is deployed and Running in the `home` namespace.
- Reconciled the deployed state against `todos/homekit-secure-video.md` and
  `logs/2026-05-31_homekit-secure-video.md`; remaining work is unchanged
  (manual runtime + pairing).

### Remaining

- The manual steps 1–8 above. No code changes pending.

### Caveats

- Could not introspect Scrypted's internal plugin/pairing progress (admin-login
  app state). Steps 1, 2, 5, 6 require physical Apple-device interaction.

## Session Log — 2026-06-26

### Done

- **Scrypted admin account created** (init done) — reached the console via
  `kubectl port-forward -n home svc/scrypted 10443:10443` → `https://localhost:10443`.
  `/login` now reports `hasLogin:true`.
- **Found + fixed the broken tailnet console URL.** `https://scrypted.tailnet-1a49.ts.net/`
  was 502: the Tailscale ingress proxies to the backend over plain HTTP but was
  pointed at Scrypted's HTTPS-only `10443`. In-cluster probes confirmed
  `http://scrypted:10443` → `000`, `http://...:11080` → `302`.
- Fix in `src/cdk8s/src/resources/home/scrypted.ts`: expose Scrypted's plaintext
  HTTP port `11080` on the container + Service, point `TailscaleIngress` at it;
  kept `10443` for direct/port-forward access. No NetworkPolicy change needed
  (`home-ingress-policy` already allows all ports from the `tailscale` namespace).
- Verified: homelab typecheck, eslint, `bun run test` (251 pass/0 fail), 1Password
  lint, full pre-commit (tier-1+2). Rendered `dist/home.k8s.yaml` ingress backend →
  `scrypted:11080`.
- **PR #1320** opened: `fix/scrypted-tailnet-ingress`.

### Remaining

- Merge **PR #1320**, let ArgoCD sync, then confirm `https://scrypted.tailnet-1a49.ts.net/`
  loads the console without port-forward.
- HKSV runtime steps still pending (in todo `homekit-secure-video.md`): install
  `@scrypted/reolink` + `@scrypted/homekit`, add the Reolink doorbell, pair the
  **camera** (not the bridge) in Apple Home, enable Stream & Recording, then
  remove the duplicate HA Front Door accessory (`:21065`).

### Caveats

- The `kubectl port-forward` is a local background process — it dies when the
  session/terminal ends. Use it for setup until #1320 deploys.
- 1Password: no Scrypted admin item was created here — store the admin
  credentials in the homelab vault.

## Session Log — 2026-06-26 (continued: full setup pass)

### Done

- Created the Scrypted admin account (`hasLogin: true`) via port-forward.
- Added the Reolink doorbell; **got the live stream working.** Root cause of the
  blank preview: camera had HTTP disabled (HTTPS-only) → Reolink API 302-redirected
  → plugin got HTML not JSON → fell back to RTMP (also off). Fix: owner enabled
  HTTP in the camera web UI (reached off-LAN via a temporary `socat` `cam-proxy`
  pod + port-forward to `192.168.1.199:443`); I enabled RTMP via the Reolink
  `SetNetPort` API. **HTTPS kept on** → HA's HTTPS:443 integration untouched.
  Stream now flows over RTSP (h264). Final camera: `http/https/rtmp/rtsp/onvif = 1`.
- Installed `@scrypted/homekit` (owner).
- **PR #1320** (Scrypted ingress → port 11080) merged + deployed — tailnet URL works.
- **PR #1321** (remove HA Front Door HomeKit accessory + dead 21065 rule) merged +
  deployed — ArgoCD `home` Synced/Healthy.
- Tore down the `cam-proxy` pod + its `:8443` tunnel.
- Rewrote `packages/docs/todos/homekit-secure-video.md` as the authoritative
  remaining-steps doc.

### Remaining

- **HomeKit pairing in Apple Home** — the one blocker. Requires an Apple device on
  the Seattle LAN (owner is in Atlanta). Options in the todo: remote into a home
  Mac / someone at the house / L2-bridge VPN / wait until home.
- Then: Stream & Allow Recording (HKSV) → verify end-to-end → remove the stale
  "No Response" Front Door tile from Apple Home.
- Kill the now-redundant `svc/scrypted 10443` port-forward (use the tailnet URL).
- Save the Scrypted admin password to the homelab 1Password vault.

### Caveats

- **The doorbell is currently absent from HomeKit** (HA accessory removed by #1321,
  Scrypted not yet paired). Expected; it returns after pairing. Doorbell still works
  in HA the whole time.
- Pairing genuinely cannot be tunneled: HomeKit needs local mDNS multicast, which
  Tailscale (L3) doesn't carry, and there is no pair-by-IP path. See the todo doc.
