# zwave-js-ui Bring-up

Post-deploy checklist for wiring the Zooz ZST39 800-series Z-Wave stick into the homelab once the device arrives.

## Status

**Blocked on hardware.** ZST39 ordered, not yet delivered. All software-only work is committed on `feat/zwave-js-ui` (PR pending).

## Already done

| Item                                                                     | Where                                                                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| cdk8s Deployment + Service + TailscaleIngress                            | `packages/homelab/src/cdk8s/src/resources/home/zwave-js-ui.ts`       |
| Wired into `home` chart (sibling to HA + eufy-security-ws)               | `packages/homelab/src/cdk8s/src/cdk8s-charts/home.ts`                |
| `TailscaleIngress` extended with optional `port` for multi-port services | `packages/homelab/src/cdk8s/src/misc/tailscale.ts`                   |
| Image pinned with sha256                                                 | `packages/homelab/src/cdk8s/src/versions.ts` (`zwavejs/zwave-js-ui`) |
| 1Password item created with 5 random-generated CONCEALED fields          | Vault `Homelab (Kubernetes)`, item `ertelv7tiogcwecrt3dxmjd2wi`      |

The 1P item has: `sessionSecret`, `s0LegacyKey`, `s2UnauthenticatedKey`, `s2AuthenticatedKey`, `s2AccessControlKey`. All values are cryptographically random (Python `secrets` module: 16-byte hex for the AES keys, 32-byte base64url for the session secret). They have **never been entered in zwave-js-ui** — they exist only to be consumed on first boot so the radio's S2 state is reproducible across pod restarts.

## Leftover work (when the stick arrives)

### 1. Plug in + identify the node

Plug ZST39 into one of the Talos nodes. The node selection matters because `hostPath` volumes are node-local — the pod must be pinned to whichever node has the device.

```bash
# Find which node the stick is on (run after plugging in)
kubectl get nodes -o name | xargs -I{} sh -c 'echo "=== {} ==="; kubectl debug -q --image=alpine {} -- ls -la /host/dev/serial/by-id/ 2>/dev/null'
```

Talos doesn't allow direct shell access; use `talosctl` or a debug pod. Easier: just check the node where Home Assistant runs (`kubectl get pod -n home -o wide | grep homeassistant`) — putting the stick there means HA + zwave-js-ui share node affinity and there's no extra hop.

### 2. Verify Talos has the USB-serial driver

The 800-series ZST39 uses the **CP210x** chip. Talos's stock kernel ships `cdc-acm` but **not** `cp210x`. If `/dev/serial/by-id/` is empty after plugging in:

```bash
talosctl -n <node> dmesg | grep -i "cp210x\|usb-serial\|silicon\|zooz"
```

If the module isn't loaded, install the `siderolabs/usb-modem` system extension (or whichever extension currently provides cp210x — check the Talos extension catalog at the time of bring-up):

```bash
talosctl -n <node> get extensions
talosctl edit machineconfig -n <node>   # add the extension under .machine.install.extensions
```

Reboot the node, then re-verify the by-id path appears.

### 3. Fill in the two constants

In `packages/homelab/src/cdk8s/src/resources/home/zwave-js-ui.ts`:

```ts
const ZWAVE_NODE_HOSTNAME = "TODO-zwave-node"; // → real hostname
const ZWAVE_HOST_DEVICE_PATH =
  "/dev/serial/by-id/TODO-usb-Zooz_800_Z-Wave_Stick_-if00"; // → real by-id path
```

Verify with `bun run build` + `bun run typecheck` in `packages/homelab/src/cdk8s/`. Commit, push, ArgoCD picks up.

### 4. First-boot configuration

Once the pod is `Running`:

1. Open `http://zwave:8091` (Tailscale).
2. **Settings → Z-Wave**:
   - Serial port: `/dev/zwave` (the in-pod mount path; ignore the host-side by-id).
   - Paste each key from the 1Password item `zwave-js-ui` into the matching field. The env vars (`KEY_S0_LEGACY` etc.) are already set, so zwave-js-ui should pre-populate them — but confirm the UI shows non-empty values before saving.
3. **Home Assistant**: Settings → Devices & Services → Add → Z-Wave.
   - Uncheck "Use the Z-Wave JS Supervisor add-on".
   - URL: `ws://zwave-js-ui.home.svc.cluster.local:3000`.
   - Save. Integration should report "Connected" within seconds.

### 5. Pair a test device

In zwave-js-ui Control Panel → "Add Node" → SmartStart QR. Confirm the device appears in HA's device list.

## Risks / known unknowns

- **kube-linter privileged-pod policies.** zwave-js-ui sets `privileged: true`; the existing `home`-namespace annotations on HA cover the same exemptions, but the deployment's annotations are duplicated locally and may need updating if kube-linter rules tighten in the future.
- **NetworkPolicy.** The existing `home-ingress-policy` does not block intra-namespace traffic, so HA → zwave-js-ui WS works without changes. Verify with `kubectl exec -n home deploy/homeassistant -- nc -zv zwave-js-ui 3000` after deploy.
- **Health probe.** Liveness/startup are TCP-only on `:8091`; the HTTP `/health` endpoint reports 500 until **both** MQTT and Z-Wave are connected, which never holds in this setup (no MQTT broker, and Z-Wave only connects post-config).
- **Talos extension churn.** Extension names in the `siderolabs/extensions` repo change between Talos versions. Look up the current cp210x-providing extension at bring-up time, not from this doc.
