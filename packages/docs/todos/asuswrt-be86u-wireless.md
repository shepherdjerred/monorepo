---
id: asuswrt-be86u-wireless
type: todo
status: planned
board: true
verification: agent
disposition: deferred
origin: packages/docs/archive/completed/2026-07-03_asuswrt-tofu-tracking.md
source_marker: false
---

# Manage RT-BE86U (192.168.1.2) wireless in the asuswrt tofu stack

The `asuswrt` tofu stack (`packages/homelab/src/tofu/asuswrt/`) manages the RT-BE86U's
`asuswrt_system` but **not** its wireless. Reason: reading its NVRAM shows
`wl0_ssid` / `wl1_ssid` = a 32-hex string, `wl{0,1}_closed = 1` (hidden), crypto
`aes+gcmp256` — the fingerprint of a **former-AiMesh backhaul** interface, not the real
"Jerred" fronthaul. AiMesh was deactivated ~6 months ago (before 2026-07-03) but this
residual state remains. Managing wl0/wl1 as-is would be managing the backhaul SSID.

## Remaining

- [ ] Read the virtual-interface SSIDs on 192.168.1.2 (read-only), e.g. `wl0.1_ssid`,
      `wl1.1_ssid`, `wl0.2_ssid`, and the AiMesh residual keys (`cfg_device_list`,
      `cfg_master`, `amas_*`) to locate the real fronthaul the BE86U broadcasts.
- [ ] Decide whether to (a) clean up the residual AiMesh/backhaul NVRAM so wl0/wl1 become
      normal fronthaul, then manage them like the other devices, or (b) manage the correct
      virtual-interface indices directly. Option (a) likely needs `asuswrt_nvram` writes and
      should be validated carefully (risk of dropping the AP off the network).
- [ ] Add the wireless resources to `packages/homelab/src/tofu/asuswrt/ap-be86u.tf` and the
      import list in `import.sh`, then confirm a clean `plan`.

## How to inspect (read-only, from the cluster)

The Mac cannot reach the LAN directly; the `torvalds` cluster can. Run this from a
machine with LAN access, or from a throwaway pod on `torvalds`.

Use the `asuswrt_nvram` data source in a scratch tofu config. It takes a `key` and
returns its `value`, and reads via `nvram_get` only — it never posts to `/apply.cgi`,
so it cannot mutate the device.

```hcl
terraform {
  required_providers {
    asuswrt = {
      source  = "shepherdjerred/asuswrt"
      version = "0.1.0"
    }
  }
}

provider "asuswrt" {
  host     = "192.168.1.2"
  port     = 8443
  https    = true
  insecure = true # self-signed router certificate
  username = var.asuswrt_username
  password = var.asuswrt_password
}

data "asuswrt_nvram" "probe" {
  for_each = toset([
    "wl0.1_ssid", "wl1.1_ssid", "wl0.2_ssid",
    "cfg_device_list", "cfg_master",
  ])
  key = each.value
}

output "probe" {
  value = { for k, d in data.asuswrt_nvram.probe : k => d.value }
}
```

Install the provider first with
`make -C packages/terraform-provider-asuswrt install`, then `tofu init` and
`tofu plan` in the scratch directory. Credentials come from the 1Password "ASUS
Router" item via `op run --env-file=.env`, as in
`packages/homelab/src/tofu/asuswrt/`.
