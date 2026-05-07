# zwave-js-ui Bring-up

Post-deploy checklist for wiring the Zooz ZST39 800-series Z-Wave stick into the homelab. Completed 2026-05-06.

## Status

**Complete.** Stick plugged into `torvalds`, pod scheduled, HA integration connected, first device (ZEN76 lightswitch) paired.

## Final shape

| Item | Where |
| --- | --- |
| cdk8s Deployment + Service + TailscaleIngress (UI only) | `packages/homelab/src/cdk8s/src/resources/home/zwave-js-ui.ts` |
| Wired into `home` chart (sibling to HA + eufy-security-ws) | `packages/homelab/src/cdk8s/src/cdk8s-charts/home.ts` |
| Image pinned with sha256 | `packages/homelab/src/cdk8s/src/versions.ts` (`zwavejs/zwave-js-ui`) |
| Node hostname (USB-stick host) | `torvalds` (only Talos node) |
| Host device path | `/dev/serial/by-id/usb-Zooz_800_Z-Wave_Stick_533D004242-if00` |
| 1Password item (`zwave-js-ui` in `Homelab (Kubernetes)`) | `ertelv7tiogcwecrt3dxmjd2wi` |

1P fields (all CONCEALED, populated):

- `sessionSecret` — 32-byte base64url, signs zwave-js-ui session cookies
- `s0LegacyKey`, `s2UnauthenticatedKey`, `s2AuthenticatedKey`, `s2AccessControlKey` — classic Z-Wave network keys (16-byte hex)
- `s2AuthenticatedKeyLr`, `s2AccessControlKeyLr` — Z-Wave Long Range keys, **distinct** from classic S2 keys (separate compromise blast radius per network class)

## Gotchas hit during bring-up

### HA → zwave-js-ui WS URL is the cluster IP, not the FQDN

The plan-as-written assumed `ws://zwave-js-ui.home.svc.cluster.local:3000` would work. It doesn't. The Home Assistant pod runs a Tailscale sidecar that overrides `/etc/resolv.conf` to point only at the Tailscale userspace DNS forwarder (`169.254.116.108`, search domain `tailnet-1a49.ts.net`). That DNS path resolves MagicDNS hostnames and falls back to upstream public resolvers — it does **not** forward to kube-dns, so HA cannot resolve any `*.svc.cluster.local` name.

Mitigation: HA is configured with the raw zwave-js-ui Service ClusterIP (`ws://10.100.162.195:3000` at time of bring-up). Same brittle-but-functional approach as the existing eufy-security-ws integration (`10.106.77.209`). The IP only changes if the Service is destroyed and recreated.

If this ever needs to be more robust:

1. Expose port 3000 via TailscaleIngress alongside 8091 — the ingress is then resolvable via MagicDNS from HA, OR
2. Fix HA's DNS to chain kube-dns before Tailscale upstream — bigger change to the HA chart, affects everything HA does

### WS Server is OFF by default in zwave-js-ui settings.json

`zwave.serverEnabled` defaults to `false`. The HA integration cannot connect (TCP 3000 refuses) until the toggle is flipped manually in the UI under Settings → Home Assistant → "WS Server", then save (forces a driver restart). This setting persists in the PVC, so it survives restarts but a fresh PVC would need it re-enabled.

### TCP probes only on :8091 (no /health)

zwave-js-ui's HTTP `/health` endpoint stays 500 until both MQTT and Z-Wave are connected. We don't run MQTT, and Z-Wave only connects post-config — so HTTP health never reports healthy. The deployment uses TCP-only liveness/startup probes against :8091 (the UI port) as a workaround.

### Talos already had cp210x driver

The plan worried about needing a `siderolabs/usb-modem` (or equivalent) Talos system extension for the CP210x USB-serial chip. The current Talos kernel (~v1.x) ships cp210x out of the box — `/dev/serial/by-id/usb-Zooz_800_Z-Wave_Stick_…` appeared immediately after plugging in, no extension install required. Step skipped.

### PIN-less inclusion path

The original plan mentioned SmartStart QR scanning for inclusion. For devices already mounted (lightswitches behind wall plates) where pulling the device to read the DSK PIN is impractical, the supported path is:

1. Add Node → Inclusion Mode: **Default**
2. Security Classes: **uncheck S2 Authenticated and S2 Access Control**, leave S2 Unauthenticated checked
3. Trigger device inclusion (e.g. ZEN76: 3× tap upper paddle)

Result: encrypted inclusion (AES-128-CCM, replay-protected day-to-day), no DSK prompt. Trade-off is no MITM protection during the ~5 second inclusion handshake. Fine for switches/lights/sensors; not appropriate for door locks or anything physical-security-relevant — those should use S2 Authenticated with the DSK.

## Drift management

- ArgoCD `home` app uses `automated: {}` sync. There is **no** `selfHeal: false` opt-out in our setup, so manual `kubectl patch` against any home-namespace resource gets reverted on the next sync (observed within 2 seconds).
- During bring-up we briefly `kubectl patch application home -n argocd --type=json -p '[{"op":"remove","path":"/spec/syncPolicy/automated"}]'` to land a hot patch on the deployment ahead of the chart publish, then auto-sync was restored from the desired Application spec on the next reconcile cycle.
- For routine config changes, edit the cdk8s code, push, let CI publish a new chart version (`2.0.0-NNNN`), and ArgoCD picks it up. No manual patches needed.
