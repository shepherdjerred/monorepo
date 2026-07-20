---
id: log-2026-07-03-asuswrt-provider-real-router-smoke
type: log
status: complete
board: false
---

# AsusWRT provider — non-destructive real-router validation

## Question

Does `packages/terraform-provider-asuswrt` actually work against a real router, not just its mocks?

## What was done

- Built the provider: `go build ./...`, `go vet ./...`, `go test ./...` all pass. But every test (including the `resource.Test` "acceptance" ones) runs against a **self-authored mock** (`internal/provider/mock_server_test.go`), not real hardware — classic self-validation trap for a reverse-engineered API.
- Wrote a **read-only** smoke command (`cmd/smoke`, since removed; source saved to scratchpad `asuswrt-smoke-main.go`) that imports the real `internal/client` package and only calls `NvramGet` (login + `/appGet.cgi`) — never `NvramSet`/`/apply.cgi`.
- Cross-compiled linux/amd64 static binary, ran it in an ephemeral `alpine` pod on the `torvalds` cluster (the network path to the router). Router reachable on **HTTPS :8443** (`Server: httpd/3.0`); HTTP :80 refused.
- Creds from 1Password item "ASUS Router" (user `jerred`), password piped via stdin (never in argv). Router: **RT-AX88U Pro**, firmware **3.0.0.6.102.7_2**.

## Findings

**Works:** login + authenticated `nvram_get`; all scalar reads correct (SSIDs, LAN IP/MAC, timezone `PST8DST`, NTP servers, model, firmware).

**Broken — packed-list parsers (`internal/client/packed.go`):**

1. **Delimiter mismatch.** Real router returns HTML-entity token strings `&#60` (`<`) and `&#62` (`>`), NOT literal `<`/`>`. `ParseDHCPStaticList` / `ParseVTSRuleList` split on the single bytes `<`/`>`, which never appear → **0 entries parsed** for both `dhcp_staticlist` and `vts_rulelist`. Re-serialization yields `""`.
2. **Field layout mismatch.** Decoding real data:
   - `dhcp_staticlist` entry = `<MAC>IP>>` → 4 `>`-separated fields `[MAC, IP, "", ""]`; parser assumes only `MAC>IP`.
   - `vts_rulelist` rule = `<name>extPort>internalIP>intPort>proto>` → 5 fields; verify parser's assumed layout.

Impact: the `asuswrt_dhcp_static_lease` and `asuswrt_port_forward` resources would read zero existing entries against this firmware (Terraform sees phantom drift / tries to recreate everything), and writes would emit malformed NVRAM. Scalar resources (`asuswrt_system`, `asuswrt_nvram`, wireless SSID) look fine on the read path.

## Follow-up: the two Asus APs

Scanned `192.168.1.0/24:8443` from the pod → 3 Asus web servers (`httpd/3.0`). Read-only login (same creds) succeeded on all three. AiMesh group (`cfg_device_list`):

| IP            | Model        | firmware         | sw_mode         | role          |
| ------------- | ------------ | ---------------- | --------------- | ------------- |
| 192.168.1.1   | RT-AX88U Pro | 3.0.0.6.102.7_2  | 1 (router)      | AiMesh master |
| 192.168.1.2   | RT-BE86U     | 3.0.0.6.102.7_2  | **3 (AP mode)** | AiMesh node   |
| 192.168.1.213 | RT-AX88U     | 3.0.0.4.388.11_0 | **3 (AP mode)** | AiMesh node   |

**Can tofu hit them? Physically yes — usefully, limited:**

- Both APs expose an independent web UI + the same `/login.cgi` + `/appGet.cgi` NVRAM API on :8443 and accept the same creds. Login + read proven.
- But they are **AiMesh nodes in AP mode**, which constrains what's manageable:
  - AP mode disables DHCP-server/WAN/port-forward (`vts_enable_x=0`, `dhcp_staticlist=""` on both) → `asuswrt_dhcp_static_lease` / `asuswrt_port_forward` are inert on the APs; only the .1 router does those.
  - Wireless is centrally managed by the AiMesh master and synced to nodes. The RT-BE86U node reports `wl0_ssid="ECB4E267…"` (a hashed **backhaul** SSID), not the real fronthaul SSID → per-node `asuswrt_wireless_network` writes would fight mesh sync / risk backhaul.
  - `asuswrt_system` (hostname/timezone/NTP) and generic `asuswrt_nvram` would work per-device, but most user-facing settings are governed by the master.
- Same packed-list encoding bug applies to `cfg_device_list` (`&#60`/`&#62`).

## Session Log — 2026-07-03

### Done

- Verified build/vet/unit tests pass but are mock-only.
- Ran a genuine read-only smoke test against the live RT-AX88U Pro from a cluster pod.
- Identified two concrete bugs in `packed.go` (entity delimiters + field layout).

### Remaining

- Fix `packed.go`: decode/split on `&#60`/`&#62` tokens (and re-encode on serialize); correct DHCP/port-forward field layouts to match firmware 3.0.0.6 (388-based).
- Update `packed_test.go` fixtures to use **real** entity-encoded strings, not literal `<`/`>`.
- Consider promoting the read-only smoke into a real `TF_ACC` acceptance test (the repo currently has none) so this class of bug is caught.
- No write-path (`/apply.cgi`) test was run — deferred until parsers are fixed.

### Caveats

- Only the read path was exercised. Write/apply semantics (NVRAM commit, `rc_service` restart) remain unverified against real hardware.
- Smoke command was removed from the tree to keep it clean; source is in the session scratchpad.
