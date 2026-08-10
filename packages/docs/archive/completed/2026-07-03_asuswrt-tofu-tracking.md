---
id: plan-2026-07-03-asuswrt-tofu-tracking
type: plan
status: complete
board: false
---

# Track all Asus routers/APs in OpenTofu

## Tracking outcome

Complete (tracking) — provider fixed + tofu stack built, verified against live
hardware, and the **shared SeaweedFS state backend is populated** (15 resources,
idempotent clean plan). Mappings validated against Asuswrt-Merlin source. Remaining
is future/optional: wireless WRITE-path redesign and BE86U fronthaul management
(both need a controlled `apply` to validate) — see todos.

## Context

The user wants OpenTofu to be the source of truth / state tracker for all three home Asus
devices. The repo already ships a custom provider (`packages/terraform-provider-asuswrt`) but
it has **never been used against real hardware** and no tofu stack consumes it. Read-only smoke
testing (see `packages/docs/logs/2026-07-03_asuswrt-provider-real-router-smoke.md`) proved the
transport/auth/scalar-read path works against the live devices but surfaced two blockers. This
plan fixes the provider, then builds a local-run tofu stack that imports each device's existing
config into shared state so it can be tracked and managed going forward.

## Devices (verified live, read-only)

| IP            | Model               | Firmware         | sw_mode  | Manage                                                   |
| ------------- | ------------------- | ---------------- | -------- | -------------------------------------------------------- |
| 192.168.1.1   | RT-AX88U Pro        | 3.0.0.6.102.7_2  | 1 router | system, 5 DHCP leases, 3 port-forwards, wireless wl0/wl1 |
| 192.168.1.2   | RT-BE86U (tri-band) | 3.0.0.6.102.7_2  | 3 AP     | system, wireless (bands TBD — see caveats)               |
| 192.168.1.213 | RT-AX88U            | 3.0.0.4.388.11_0 | 3 AP     | system, wireless wl0/wl1                                 |

All three: same creds (1Password item **"ASUS Router"**, user `jerred`), HTTPS :8443, self-signed
(`insecure=true`). AiMesh was deactivated ~6mo ago; residual `cfg_*` NVRAM state remains.

## Decisions (from user)

- **CI drift = local-run only for v1.** Do NOT add `asuswrt` to `TOFU_STACKS`. CI's Dagger tofu
  container has tailnet-only egress and cannot reach `192.168.1.x`; wiring drift-detection would
  need a new Tailscale subnet router (deferred). State still lives in the shared S3/SeaweedFS
  backend, so it's durable and shared.
- **Manage everything now** (full table above), non-destructively via `tofu import` → verify clean
  `plan` before any `apply`.

## Blockers to fix in the provider (prerequisites)

1. **Packed-list parser assumes literal `<`/`>`; real router uses HTML-entity tokens `&#60`/`&#62`.**
   `internal/client/packed.go` — `ParseDHCPStaticList`, `ParseVTSRuleList` (and their `Serialize*`
   counterparts, `ParseDHCPHostnames`) return 0 entries against live data. Also the field layout
   differs: live `dhcp_staticlist` entry = `<MAC>IP>>` (extra trailing fields), live `vts_rulelist`
   rule = `<name>ext>intip>intport>proto>`.
2. **No resource implements `ImportState`** — required to track existing config without recreating
   it. All 5 resources in `internal/provider/*_resource.go` need it. Their `Read` already keys off
   the identity attr (`mac`/`name`/`band`/`key`, or the `system` singleton), so import mostly seeds
   that one attr. Watch the `readOptional*` guards in `system`/`wireless_network` resources: they
   skip null targets, so a bare import won't populate optionals — the import path must handle this.

## Plan

### Phase 0 — Prove the loop end-to-end (before full buildout)

Load-bearing validation using the **safe singleton** (`asuswrt_system`, no packed dependency):

1. `cd packages/terraform-provider-asuswrt && make install` (builds + copies to filesystem mirror).
2. Throwaway `provider.tf` + one `asuswrt_system` resource pointed at 192.168.1.1, creds via
   `op run`. `tofu init` (finds mirrored provider) → `tofu import asuswrt_system.router system`.
3. **Gate:** after adding `ImportState` to `system` (Phase 1 item), `tofu plan` must show **no
   changes**. This proves: mirror install, auth, import, and refresh round-trip all work against
   real hardware before we invest in the full stack. Also read `wl0/wl1/wl2_ssid` on the BE86U here
   to resolve which bands broadcast (caveats).

### Phase 1 — Provider fixes (Go)

- `internal/client/packed.go`: decode/encode on the `&#60`/`&#62` tokens (not literal `<`/`>`);
  correct DHCP + port-forward field layouts to match live firmware. Verify exact `dhcp_staticlist`
  field order (DNS vs hostname placement; the separate `dhcp_hostnames` key looks obsolete on
  3006/388 — hostname may live inside `dhcp_staticlist`).
- Add `ImportState` (`resource.ResourceWithImportState`) to all 5 resources. Import IDs:
  `system`→`"system"`, `nvram`→key, `dhcp_static_lease`→MAC (uppercased), `port_forward`→name,
  `wireless_network`→band index (set `id=wl{band}`). Handle the `readOptional*` null-skip so
  imported optionals populate.
- `internal/provider/*_test.go` + `internal/client/packed_test.go`: replace literal `<`/`>`
  fixtures with **real entity-encoded** strings captured from the devices; add ImportState tests.
- Keep `go build ./... && go vet ./... && go test ./...` green.

### Phase 2 — Tofu stack `packages/homelab/src/tofu/asuswrt/`

Mirror existing stack conventions (`cloudflare/`, `pagerduty/`):

- `backend.tf` — S3/SeaweedFS backend, `key = "asuswrt/terraform.tfstate"` (copy `pagerduty/backend.tf`).
- `providers.tf` — `required_providers { asuswrt = { source = "shepherdjerred/asuswrt", version = "0.1.0" } }`
  with **3 aliased provider blocks** (`router`, `ap_be86u`, `ap_ax88u`), each `host`/`insecure=true`,
  creds from vars.
- `variables.tf` — `asuswrt_username`, `asuswrt_password` (sensitive), fed by `TF_VAR_*`.
- `main.tf` (or per-device files) — the resources per the Manage table, each with its `provider =`
  alias. Router gets system + 5 `asuswrt_dhcp_static_lease` + 3 `asuswrt_port_forward` +
  `asuswrt_wireless_network` wl0/wl1; APs get system + wireless.
- `packages/homelab/src/tofu/.env` — add `TF_VAR_asuswrt_username`/`asuswrt_password` →
  `op://Personal/ASUS Router/...` for local `op run`.
- `packages/homelab/src/tofu/README.md` — document the stack + why it's local-run-only (LAN egress).

### Phase 3 — Import existing config + verify clean plan

- Inventory each device's live values (already have: 5 leases, 3 port-forwards, SSIDs) and write
  matching HCL.
- `tofu import` each resource (per-device alias addresses). `tofu plan` must converge to **no
  changes** — that is the definition of "tracked". Reconcile any diffs by fixing HCL to match
  reality (never the other direction blindly).
- No `apply` needed to reach "tracked"; apply only when the user later wants to change something.

### Out of scope / future

- CI drift-detection (needs Tailscale subnet router for `192.168.1.0/24` + provider baked into the
  tofu image + creds threaded through the OpenTofu lanes in `.buildkite/pipeline.yml` — the
  `for stack in …` allowlists in the `pr-dryrun` plan loop and the `tofu-apply` apply loop, which
  drive `packages/homelab/scripts/tofu-stack.ts`; `asuswrt` is deliberately absent from both).
- Cleaning residual AiMesh `cfg_*` NVRAM state (possible later via `asuswrt_nvram`, risky — leave).

## Caveats

- **BE86U wireless bands:** its `wl0_ssid` read back as a 32-hex hash (former AiMesh backhaul
  signature), not "Jerred". Phase 0 must read wl0/wl1/wl2 to find the real broadcast SSID(s) before
  writing wireless resources; band 0 may still be reserved. Don't manage a band that isn't a real
  fronthaul.
- **`wpa_passphrase` is write-only** (never read back). If tracked in HCL, every `apply` will
  rewrite it and `plan` can't detect drift on it. Decide during impl: manage SSID/auth/channel/
  hidden but source the passphrase from 1Password (or omit it and manage passphrases out-of-band)
  to keep plans clean.
- **AP mode** disables DHCP-server/WAN/port-forward on .2/.213 (`vts_enable_x=0`, empty
  `dhcp_staticlist`) — correctly, only the router manages those.
- **Different firmware** (.213 on 388.11 vs others on 102.7) may have subtle key/format differences;
  validate packed parsing against each device, not just one.
- **Wireless write-fidelity:** router band 1 uses `wl1_bw=3` (80 MHz on this firmware, not the
  provider's documented `4=80`) with chanspec `149/80`. Import and plan are clean, but a wireless
  `apply` could reformat chanspec/bw — validate on hardware before relying on wireless writes.
- **Build parity:** the shared state was populated with the linux build while operators run the
  darwin build via `make install`. Same source, so plans match. The stack's `.terraform.lock.hcl` is
  gitignored, because a custom mirror provider produces local-only hashes.

## Verification

- Provider: `make install`; `go build ./... && go vet ./... && go test ./...` green with real fixtures.
- End-to-end (the real proof): from `packages/homelab/src/tofu/asuswrt`,
  `op run --env-file=../.env -- tofu init` → `... tofu plan` shows **No changes** after imports.
- Re-run the read-only smoke (scratchpad `asuswrt-smoke-main.go`) if needed to re-capture live NVRAM
  for fixtures. All device interaction stays read-only until the user approves an `apply`.

## Confidence / API-mapping verification

Every mapping is grounded against Asuswrt-Merlin source (tags `3006.102.7` for the
RT-AX88U Pro, `3004.388.11` for the RT-AX88U) plus read-only NVRAM triangulation.

| Mapping                                                   | Confidence         | Evidence                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `&#60`/`&#62` delimiters                                  | Very high          | Byte-exact round-trip + JS builders                                                                                                                                              |
| DHCP `MAC>IP>DNS>hostname`                                | High               | C `write_static_leases()`/`vstrsep`; oracle test                                                                                                                                 |
| DHCP hostname in `dhcp_staticlist` (NOT `dhcp_hostnames`) | High — **fixed**   | `dhcp_hostnames` key doesn't exist on this firmware; rewired to field 4                                                                                                          |
| Port-forward `name>ext>intIP>intPort>proto>srcIP`         | High               | JS parser+builder; oracle test                                                                                                                                                   |
| Serialize == firmware builder                             | High               | Oracle tests assert byte-for-byte                                                                                                                                                |
| Auth `wl_auth_mode_x`                                     | High               | Source-confirmed authoritative key                                                                                                                                               |
| System hostname key                                       | High — **fixed**   | Was `computer_name` (Samba name, empty). Real key = `lan_hostname` (verified live: `RT-AX88U_Pro-74C0` etc.)                                                                     |
| DHCP/port-forward WRITE completeness                      | High               | UI POSTs only the list key(s) + rc_service; no count key exists — our writes match                                                                                               |
| Wireless READ (`wl<band>_*`)                              | High               | Correct values on both firmwares (read-only)                                                                                                                                     |
| Wireless WRITE                                            | Low (unverifiable) | 3006 UI writes band-named `2g1_*`/`5g1_*`; `wl_bw` codes firmware-dependent (0/1 swap); SAE needs `wl_mfp`; needs a controlled apply. See `todos/asuswrt-wireless-write-path.md` |

### Corrections that verification produced

- **DHCP hostname** now read/written in `dhcp_staticlist` field 4 (removed the
  nonexistent `dhcp_hostnames` key and its helpers).
- **System hostname** `computer_name` → `lan_hostname` (with per-field rc_service:
  `restart_net_and_phy` for hostname, `restart_time` for zone/NTP). Configs set the
  real hostnames.
- **Singleton `id` perpetual-diff** — added `UseStateForUnknown()` to `system` (and
  `wireless`) `id`. This drift only surfaced against the S3 backend, not local state;
  fixed and confirmed idempotent (two clean plans).
- **Independent-oracle tests** — `Serialize` asserted equal to the firmware JS builder
  output byte-for-byte for DHCP and port-forward.
