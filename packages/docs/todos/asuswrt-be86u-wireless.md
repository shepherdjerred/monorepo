---
id: asuswrt-be86u-wireless
status: active
origin: packages/docs/plans/2026-07-03_asuswrt-tofu-tracking.md
source_marker: false
---

# Manage RT-BE86U (192.168.1.2) wireless in the asuswrt tofu stack

The `asuswrt` tofu stack (`packages/homelab/src/tofu/asuswrt/`) manages the RT-BE86U's
`asuswrt_system` but **not** its wireless. Reason: reading its NVRAM shows
`wl0_ssid` / `wl1_ssid` = a 32-hex string, `wl{0,1}_closed = 1` (hidden), crypto
`aes+gcmp256` — the fingerprint of a **former-AiMesh backhaul** interface, not the real
"Jerred" fronthaul. AiMesh was deactivated ~6 months ago (before 2026-07-03) but this
residual state remains. Managing wl0/wl1 as-is would be managing the backhaul SSID.

## Next steps

1. Read the virtual-interface SSIDs on 192.168.1.2 (read-only), e.g. `wl0.1_ssid`,
   `wl1.1_ssid`, `wl0.2_ssid`, and the AiMesh residual keys (`cfg_device_list`,
   `cfg_master`, `amas_*`) to locate the real fronthaul the BE86U broadcasts.
2. Decide whether to (a) clean up the residual AiMesh/backhaul NVRAM so wl0/wl1 become
   normal fronthaul, then manage them like the other devices, or (b) manage the correct
   virtual-interface indices directly. Option (a) likely needs `asuswrt_nvram` writes and
   should be validated carefully (risk of dropping the AP off the network).
3. Add the wireless resources to `packages/homelab/src/tofu/asuswrt/ap-be86u.tf` and the
   import list in `import.sh`, then confirm a clean `plan`.

## How to inspect (read-only, from the cluster)

The Mac cannot reach the LAN directly; the `torvalds` cluster can. Use a throwaway pod
plus the read-only NVRAM approach used during the original investigation (see
`packages/docs/logs/2026-07-03_asuswrt-provider-real-router-smoke.md`), or the
`asuswrt_nvram` data source in a scratch tofu config.
