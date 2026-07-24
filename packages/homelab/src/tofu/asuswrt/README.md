# asuswrt — Asus routers & APs

Tracks configuration of the three home Asus devices as OpenTofu state using the
custom `terraform-provider-asuswrt` (built from `packages/terraform-provider-asuswrt`).

| Alias      | Device       | IP            | Mode   | Managed here                                                            |
| ---------- | ------------ | ------------- | ------ | ----------------------------------------------------------------------- |
| `router`   | RT-AX88U Pro | 192.168.1.1   | router | system, DHCP static leases, port-forwards, wireless wl0/wl1             |
| `ap_ax88u` | RT-AX88U     | 192.168.1.213 | AP     | system, wireless wl0/wl1                                                |
| `ap_be86u` | RT-BE86U     | 192.168.1.2   | AP     | system (wireless deferred — see `docs/todos/asuswrt-be86u-wireless.md`) |

## Local-run only (NOT in CI)

This stack is **deliberately excluded from the CI drift-check** (`TOFU_STACKS` in
`scripts/ci/src/catalog.ts`). The Dagger tofu container has tailnet egress only and
cannot reach the LAN (`192.168.1.0/24`); wiring drift-detection would require a
Tailscale subnet router advertising the LAN, which does not exist yet. Run this
stack locally from a machine that is on **both** the home LAN (to reach the routers)
and the tailnet (to reach the SeaweedFS state backend).

State still lives in the shared SeaweedFS S3 backend (`asuswrt/terraform.tfstate`),
so it is durable and shared.

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

- **wpa_passphrase is not managed.** It is write-only (never read back), so tracking
  it would rewrite the PSK on every apply and never show honest drift. Manage the WiFi
  password out-of-band. Wireless SSID/auth/crypto/channel/bandwidth/hidden are tracked.
- **Wireless write-fidelity:** on the router, band 1 reports `wl1_bw=3` (80 MHz on this
  firmware) and chanspec `149/80`. Import/plan are clean, but the provider's chanspec/
  bandwidth encoding does not model every firmware code, so a future `apply` that changes
  wireless could reformat these. Verify a wireless `apply` on hardware before relying on it.
- **AP mode** disables DHCP-server / WAN / port-forward on the two APs, so only system and
  wireless are managed there.
