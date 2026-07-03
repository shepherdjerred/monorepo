---
id: asuswrt-wireless-write-path
status: blocked
origin: packages/docs/plans/2026-07-03_asuswrt-tofu-tracking.md
source_marker: false
---

# asuswrt wireless WRITE path is unverified and firmware-dependent

The `asuswrt_wireless_network` resource **reads** correctly on both firmwares (the
`wl<band>_*` NVRAM keys hold the real values on the RT-AX88U 388.x and RT-AX88U Pro
3006 — verified read-only). Tracking/import is fine. The **write** path (`apply`) is
not verified and has firmware-specific hazards found in Asuswrt-Merlin source:

1. **3006 uses band-named keys, not `wl<band>_`.** On the RT-AX88U Pro (3006) the web
   UI writes `2g1_*` / `5g1_*` / `6g1_*` (prefix from `wlnband_list`), not `wl0_*`/`wl1_*`.
   The `wl<unit>_*` keys still _read back_ correct values (driver keeps them), but whether
   a `wl<unit>_*` **write** is honored by `restart_wireless` on 3006 cannot be determined
   from the web/JS source — it needs a live read-back after an apply. (Source: 388 uses
   classic unprefixed `wl_*` + `wl_unit`; 3006 uses band-named `httpApi.nvramSet`.)
2. **`wl_bw` codes are not firmware-stable.** 3006 Broadcom: 0=Auto,1=20,2=40,3=80,4=80+80,
   5=160,6=240/320. 388 Broadcom **swaps 0/1** (1=Auto, 0=20). The provider's
   `bandwidthToString` (1=20,2=40,4=80,5=160) is wrong for both in places. Prefer
   `wl_chanspec` (unambiguous) over `wl_bw` for width.
3. **`formatChanspec` is incomplete.** It doesn't emit 2.4 GHz 40 MHz sidebands (`6u`/`6l`)
   or 6 GHz WiFi7 forms (`6g37/320-1`), and drops the width when the bw code isn't in its
   table. A write could set an inconsistent `wl_bw` vs `wl_chanspec`.
4. **SAE/WPA3 needs `wl_mfp`.** `psk2sae`/`sae` require `wl_mfp >= 1`/`= 2`; the resource
   doesn't write `wl_mfp`, so setting an SAE auth mode via tofu could produce a
   non-functional band. (WPA2-PSK is fine.)

## Recommended redesign (needs a controlled apply to validate)

- Model wireless channel/width as a single `chanspec` string attribute (firmware-stable,
  1:1 with `wl_chanspec`) instead of `channel`+`bandwidth` ints; keep `bw` in sync or
  derive it.
- Add `mfp` handling (force for SAE/WPA3).
- On 3006, target the band-named keys (map via `wlnband_list`); confirm with a read-back.
- Validate each with: apply a no-op-equivalent change on real hardware, read NVRAM back,
  confirm it matches. This requires an `apply` (blocked: user does not want router writes yet).

Until then, treat `asuswrt_wireless_network` as **read/track-only**; do not `apply` wireless
changes without a hardware read-back test.
