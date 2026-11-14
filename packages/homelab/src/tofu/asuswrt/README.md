# asuswrt — Asus routers & APs

Tracks configuration of the three home Asus devices as OpenTofu state using the
custom `terraform-provider-asuswrt` (built from `packages/terraform-provider-asuswrt`).

The configuration is synthesized from
`packages/homelab-cdktn/src/stacks/asuswrt.ts`. To change a device setting,
edit it there, run `bun run --cwd packages/homelab-cdktn synth` and commit the
updated `main.tf.json`; never edit that file by hand. The stack's TypeScript
bindings are generated from the same locally built provider, so
`bunx turbo run generate --filter=@homelab/cdktn` needs Go as well as `tofu`
and Node.

| Alias      | Device       | IP            | Mode   | Managed here                                                |
| ---------- | ------------ | ------------- | ------ | ----------------------------------------------------------- |
| `router`   | RT-AX88U Pro | 192.168.1.1   | router | system, DHCP static leases, port-forwards, wireless wl0/wl1 |
| `ap_ax88u` | RT-AX88U     | 192.168.1.214 | AP     | system, wireless wl0/wl1                                    |
| `ap_be86u` | RT-BE86U     | 192.168.1.2   | AP     | system (wireless is not managed yet)                        |

## Local-run only (CI validates, never plans)

Woodpecker's `tofu-validate` step validates this stack offline on pull
requests like every other, against the provider built from this repository,
and every main build archives it. Nothing in CI or Delivery plans or applies
it: those pods have tailnet egress only and cannot reach the LAN
(`192.168.1.0/24`), which would take a Tailscale subnet router advertising the
LAN that does not exist yet. Run this stack locally from a machine that is on **both** the
home LAN (to reach the routers) and the tailnet (to reach the SeaweedFS state
backend).

State still lives in the shared SeaweedFS S3 backend (`asuswrt/terraform.tfstate`),
so it is durable and shared.

The Storm's Bedrock path uses a separate 30004/UDP port forward to its
Kubernetes NodePort. Shuxin retains 30003/UDP. This router stack is local-run
only, so a source release alone does not activate the new public port.

## Provider install (filesystem mirror)

The provider is not published to a registry. Install it into the local filesystem
mirror that `tofu init` checks before the network:

```bash
make -C packages/terraform-provider-asuswrt install
```

This builds and copies the plugin to
`~/.terraform.d/plugins/registry.opentofu.org/shepherdjerred/asuswrt/0.1.0/<os>_<arch>/`.

## Usage

```bash
cd packages/homelab/src/tofu

# First time: import existing device config into state (see import.sh)
op run --env-file=.env -- tofu -chdir=asuswrt init
op run --env-file=.env -- ./asuswrt/import.sh

# Thereafter
op run --env-file=.env -- tofu -chdir=asuswrt plan
op run --env-file=.env -- tofu -chdir=asuswrt apply
```

Credentials come from the 1Password item **"ASUS Router"** via `TF_VAR_asuswrt_username`
/ `TF_VAR_asuswrt_password` (see `../.env`). All three devices share the same login.

## Notes / caveats

- **wpa_passphrase is never verified.** The provider can write it, but
  `readWireless` never reads it back onto state, so a configured passphrase plans
  cleanly and drift is invisible: a PSK changed on the router directly will never
  be reported. A quiet plan says nothing about the passphrase. Manage the WiFi
  password out-of-band. Wireless SSID/auth/crypto/channel/bandwidth/hidden are tracked.
- **Wireless write-fidelity:** on the router, band 1 reports `wl1_bw=3` (80 MHz on this
  firmware) and chanspec `149/80`. Import/plan are clean, but the provider's chanspec/
  bandwidth encoding does not model every firmware code, so a future `apply` that changes
  wireless could reformat these. Verify a wireless `apply` on hardware before relying on it.
- **AP mode** disables DHCP-server / WAN / port-forward on the two APs, so only system and
  wireless are managed there.
