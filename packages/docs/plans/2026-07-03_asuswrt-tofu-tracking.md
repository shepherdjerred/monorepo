# Track all Asus routers/APs in OpenTofu

## Status

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
  tofu image + creds threaded through `scripts/ci/src/steps/tofu.ts` and the Dagger helpers).
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

## Verification

- Provider: `make install`; `go build ./... && go vet ./... && go test ./...` green with real fixtures.
- End-to-end (the real proof): from `packages/homelab/src/tofu/asuswrt`,
  `op run --env-file=../.env -- tofu init` → `... tofu plan` shows **No changes** after imports.
- Re-run the read-only smoke (scratchpad `asuswrt-smoke-main.go`) if needed to re-capture live NVRAM
  for fixtures. All device interaction stays read-only until the user approves an `apply`.

## Session Log — 2026-07-03

### Done

- **Provider fix — `packed.go`**: rewrote parse/serialize to use the real
  `&#60`/`&#62` entity-token delimiters (was literal `<`/`>` → 0 entries on real
  firmware) with exact round-trip fidelity (4-field DHCP `<MAC>IP>DNS>Hostname`,
  6-field port-forward). Added `DNS` field to `DHCPStaticEntry` to preserve
  per-client data. `packed_test.go` rewritten with live-captured strings + exact
  round-trip assertions.
- **Provider — ImportState** on all 5 resources (`system`, `nvram`,
  `dhcp_static_lease`, `port_forward`, `wireless_network`). Fixed the
  `readOptional*` null-skip so imported state reflects the router (skip-empty, not
  skip-null). ImportState acceptance tests added. `go build/vet/test` + `gofmt` green.
- **Tofu stack** `packages/homelab/src/tofu/asuswrt/` — backend (SeaweedFS S3),
  3 aliased providers, `variables.tf`, `router.tf` / `ap-ax88u.tf` / `ap-be86u.tf`,
  `import.sh`, `README.md`. Added `TF_VAR_asuswrt_*` to `src/tofu/.env`, updated
  `src/tofu/README.md`, added `packages/terraform-provider-asuswrt/.gitignore`.
  `tofu validate` + `tofu fmt` clean.
- **Verified live** (from a `torvalds` cluster pod — Mac can't reach the LAN; local
  state, no writes to shared backend): the mirrored provider + `init` + `import` of
  **all 15 resources** across .1/.2/.213 → `tofu plan` = **"No changes"** (exit 0).
  Also captured the full wireless NVRAM inventory for all three devices.

### Remaining

- **Populate the shared state backend** (user step; not done to avoid mutating shared
  prod state / needs AWS+router creds): from a machine on the LAN **and** tailnet:
  `make -C packages/terraform-provider-asuswrt install` then
  `op run --env-file=.env -- tofu -chdir=asuswrt init` and `... ./asuswrt/import.sh`.
- **BE86U wireless** — deferred; see `packages/docs/todos/asuswrt-be86u-wireless.md`.
- Open a PR (not committed — awaiting user).

### Caveats

- **wpa_passphrase** is write-only (never read); intentionally unmanaged to keep plans
  honest. WiFi password managed out-of-band.
- **Wireless write-fidelity**: router band 1 uses `wl1_bw=3` (80 MHz on this firmware,
  not the provider's documented `4=80`) with chanspec `149/80`. Import/plan are clean,
  but a future wireless `apply` could reformat chanspec/bw — validate on hardware before
  relying on wireless writes. (Potential follow-up: firmware-accurate bw mapping.)
- **CI**: stack is excluded from `TOFU_STACKS` by design (CI has no LAN egress).

## Confidence / API-mapping verification (pass 2, 2026-07-03)

Grounded every mapping against Asuswrt-Merlin source (tags `3006.102.7` for the
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

### Fixes made this pass

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

## Session Log — 2026-07-03 (pass 2: certainty)

### Done

- Two authoritative research passes against Merlin source; confirmed formats, found
  and fixed the `computer_name`→`lan_hostname` bug and the `dhcp_hostnames` non-existence.
- Added oracle serialize tests; fixed the singleton `id` perpetual-diff.
- **Populated the shared SeaweedFS state** (`asuswrt/terraform.tfstate`, 15 resources)
  from a cluster pod (reads router read-only, writes only to S3) — idempotent clean plan.
- All done without any write to the router (`nvram_get` only; no `/apply.cgi`).

### Remaining

- Wireless WRITE-path redesign (chanspec-first, `mfp`, 3006 band-named keys) — needs a
  controlled `apply`. `todos/asuswrt-wireless-write-path.md`.
- BE86U fronthaul (real SSIDs on `wl0.1`/`wl1.1`) — provider can't address virtual
  interfaces yet. `todos/asuswrt-be86u-wireless.md`.
- Open PR (branch `feature/asuswrt-tofu-tracking`).

### Caveats

- Wireless apply is unverified; treat `asuswrt_wireless_network` as track-only until a
  hardware read-back test is run.
- The shared state was populated with the linux build; users run the darwin build via
  `make install` — same source, so plans match. The stack's `.terraform.lock.hcl` is
  gitignored (custom mirror provider → local-only hashes).
