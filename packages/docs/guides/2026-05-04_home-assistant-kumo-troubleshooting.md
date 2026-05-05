# Home Assistant — Kumo Integration Troubleshooting (2026-05-04)

> _Heads up: this guide was investigated and drafted with help from an AI agent. Every diagnostic command and the working fix have been run against the live HA pod and verified to work in this homelab. Treat the upstream-version claims, MAC OUIs, and code-path references as a starting point if you're applying this elsewhere — re-verify against current upstream before relying on them._

## Summary

This guide replaces [2026-04-26 Kumo troubleshooting](../archive/superseded/2026-04-26_home-assistant-kumo-troubleshooting.md), whose diagnosis was wrong. That doc concluded that the kumostat dongle's local password had drifted from the cloud's view and prescribed physical re-pair via the Comfort App or factory reset. After re-investigating without doing any physical action, the actual root cause turned out to be much simpler:

- DHCP leases reshuffled, so the IP recorded in `/config/kumo_cache.json` for one unit now points at the **other** unit's dongle. Pykumo signs every local poll with the password from the cache; that password tries to authenticate against the wrong dongle and fails with `device_authentication_error`.
- Compounding this: HA's DHCP discovery filter doesn't include the OUI Mitsubishi adapters in this homelab actually use (`50:26:EF`, Murata Manufacturing — see the [DHCP-filter gap](#the-dhcp-filter-gap) section), so the integration can't auto-discover IPs and falls back to whatever's in the cache.
- And further: the V3 setup path in `validate_input` (`config_flow.py`) doesn't pass `kumo_dict=` when constructing `KumoCloudAccount`, so even a correct cache file isn't loaded during initial UI setup. V3 returns 0 devices, the flow falls through to V2 (broken post-Comfort-App migration), and only a subset of units make it through.

The fix was to write `kumo_cache.json` directly with the correct mapping, add the integration in the UI, then for any units missed in first-pass setup, append them to the freshly-saved cache and reload the integration. No re-pair, no factory reset, no Wi-Fi credential loss on the dongles.

## Architecture (post-Comfort-App migration)

```
HA core ── HACS custom_components/kumo ── pykumo (PyPI) ── HTTP/JSON
                                                          ├─→ Mitsubishi V3 cloud (Comfort App)
                                                          │       ↳ REST: serial/label/cryptoSerial
                                                          │       ↳ Socket.IO: adapter_update events with passwords
                                                          └─→ kumostat dongle on LAN (HMAC-signed PUT /api?m=…)
```

Four facts the architecture forces, all worth memorising:

- **The cloud does not store dongle passwords.** Each dongle pushes its current password to V3 via an `adapter_update` Socket.IO event when the cloud asks for one. An offline dongle (`Network Error` in the Comfort App) won't push, and `KumoCloudV3.get_passwords_via_websocket` will time out for that unit while still succeeding for any units that are online. So a partial V3 result usually means "one of the dongles is briefly offline," not "the integration is broken."
- **Local LAN auth uses `password` + `cryptoSerial` from V3.** Pykumo HMAC-signs every `PUT /api?m=<token>` with both. If either is mismatched relative to what the dongle expects, you get `device_authentication_error` — the same error you'd get if you signed against the wrong dongle entirely. Hence the failure mode where stale (IP, password) pairings look indistinguishable from genuine credential drift.
- **V3 does not return the dongle's IP.** It returns `serial`, `label`, `cryptoSerial`, `password`, and (sometimes) `mac`. The integration learns IPs from HA's DHCP discovery (per the OUIs in `manifest.json`'s `dhcp` array) or from a previously-saved `kumo_cache.json`. With neither, V3 setup ends up with `address=""` for every unit and the final filter `zone_table = {s:e for s,e in zone_table.items() if e.get("address")}` drops everything.
- **V2 is partially broken post-Comfort-App migration** (March 2025, [issue #189](https://github.com/dlarrick/hass-kumo/issues/189)). V2 may return only a subset of registered units. `validate_input` falls back to V2 when V3 yields 0 devices, so a setup that landed on V2 may finish with some-but-not-all of your units configured — making it look like the missing units are unpaired, when in fact V2 just silently dropped them.

## Component versions that matter

- `dlarrick/hass-kumo` ≥ **v0.4.3** — V3-first setup path ([PR #196](https://github.com/dlarrick/hass-kumo/pull/196)).
- `dlarrick/pykumo` ≥ **0.4.1** — preserves cached values when V3 lookup fails ([PR #65](https://github.com/dlarrick/pykumo/pull/65)).
- Tracking issues worth keeping in mind: [#189](https://github.com/dlarrick/hass-kumo/issues/189) (Comfort App migration) and [#209](https://github.com/dlarrick/hass-kumo/issues/209) (`prefer_cache` not honored / V3 timeout).

## The DHCP-filter gap

`custom_components/kumo/manifest.json` currently filters DHCP discovery on three OUIs:

```json
"dhcp": [
    { "macaddress": "24CD8D*" },
    { "macaddress": "388D3D*" },
    { "macaddress": "7087A7*" }
]
```

In this homelab both Mitsubishi adapters present radio MACs in **`50:26:EF`** (Murata Manufacturing). Mitsubishi appears to use Murata Wi-Fi modules in some hardware revisions, so the radio MAC is in Murata's pool, not in any Mitsubishi-branded OUI. HA never matches and never auto-discovers the dongles, so `candidate_ips` is always empty, and `try_setup_v3_only` can't place any unit's IP. There is a tracking issue filed upstream proposing `5026EF*` be added to the filter (see [the upstream issue note](#upstream-issue) below).

## Diagnostic commands

```bash
POD=$(kubectl get pod -n home -o name | grep homeassistant | head -1 | sed 's|pod/||')

# Versions
kubectl exec -n home "$POD" -c main -- sh -c '
  grep -E "version|requirements" /config/custom_components/kumo/manifest.json
'

# Cache contents (serial → label → IP → MAC)
kubectl exec -n home "$POD" -c main -- python3 -c '
import json
d = json.load(open("/config/kumo_cache.json"))
for s, u in d[2]["children"][0]["zoneTable"].items():
    print(s, u["label"], u["address"], u["mac"])
'

# Find Mitsubishi adapters by Murata OUI on the LAN
kubectl exec -n home "$POD" -c main -- nmap -sn -PR 192.168.1.0/24 \
  2>&1 | grep -B1 -i "50:26:EF"
```

### Local probe — test every cached unit's creds against its IP

```bash
kubectl exec -n home "$POD" -c main -- pip install --user pykumo
```

`probe_kumo.py`:

```python
import json, time
from pykumo import PyKumo

with open("/config/kumo_cache.json") as f:
    cache = json.load(f)

units = []
def walk(x):
    if isinstance(x, dict):
        if "serial" in x and "cryptoSerial" in x:
            units.append(x)
        for v in x.values():
            walk(v)
    elif isinstance(x, list):
        for v in x:
            walk(v)
walk(cache)

print("found", len(units), "units in cache")
for u in units:
    cfg = {"address": u["address"], "password": u["password"], "crypto_serial": u["cryptoSerial"]}
    k = PyKumo(u["label"], u["address"], cfg, None, None)
    t0 = time.time()
    ok = k.update_status()
    print(u["label"], "@", u["address"], "update_status=", repr(ok),
          "(%.1fs)" % (time.time() - t0))
    if ok:
        print("  mode=", repr(k.get_mode()),
              "room_temp=", repr(k.get_current_temperature()),
              "setpoint_heat=", repr(k.get_heat_setpoint()),
              "setpoint_cool=", repr(k.get_cool_setpoint()))
```

`update_status=True` in <1s = local auth works. `False` after ~33s of timeouts (every status field returning `device_authentication_error`) = wrong (IP, password) pairing or a genuinely offline dongle. Use the V3 probe below to disambiguate.

### V3 probe — confirm the cloud sees both units and what passwords they're broadcasting

Comfort App credentials are in 1Password as `Kumo Cloud`.

```python
import os
from pykumo.py_kumo_cloud_account_v3 import KumoCloudV3

v3 = KumoCloudV3(os.environ["KUMO_USER"], os.environ["KUMO_PASS"])
for serial, dev in v3.get_all_device_credentials().items():
    print(serial, dev["label"], dev.get("password","")[-4:], dev.get("cryptoSerial","")[-4:])
```

Reading the result:

- V3 returns fewer units than expected → at least one dongle is briefly offline; retry in a few seconds.
- V3 returns all units but the local probe still fails → wrong (IP, password) pairing, which is the failure mode this guide documents.
- V3 returns all units and the local probe succeeds → setup is a config-flow problem, not a credentials problem; jump straight to the [working fix recipe](#working-fix-recipe).

### Mapping serials to physical dongles

V3 returns serials but no IPs. The `nmap` scan returns IPs but no serials. To pair them, probe every (serial, IP) combination:

```python
for serial, dev in v3_devices.items():
    for ip in candidate_ips:  # from nmap
        cfg = {"address": ip, "password": dev["password"], "crypto_serial": dev["cryptoSerial"]}
        k = PyKumo(dev["label"], ip, cfg, None, None)
        if k.update_status():
            print(serial, "->", ip)  # found the right dongle for this serial
            break
```

Whichever (serial, IP) pair lights up `update_status=True` is the correct mapping. Anything else returns `device_authentication_error` and a 33-second timeout per attempt, so this is slow but reliable.

## Working fix recipe

The sequence that actually got both units online in this homelab:

1. **Enumerate physical dongles.** `nmap -sn -PR <subnet>` filtered on `50:26:EF`. Record IP and MAC for each.
2. **Fetch fresh creds from V3** with `KumoCloudV3.get_all_device_credentials()`. You get `serial`, `label`, `password`, `cryptoSerial` per unit (no IP, no MAC).
3. **Map serials to IPs** by probing every (serial, IP) combination as above. Record the correct mapping.
4. **Write `/config/kumo_cache.json` directly** with all seven required fields per unit. The structure pykumo expects:

   ```json
   [
     {},
     {},
     {
       "children": [
         {
           "zoneTable": {
             "<SERIAL>": {
               "serial": "<SERIAL>",
               "label": "<friendly name>",
               "password": "<from V3>",
               "cryptoSerial": "<from V3>",
               "mac": "<from nmap>",
               "unitType": "ductless",
               "address": "<from nmap>"
             }
           }
         }
       ]
     }
   ]
   ```

   `_extract_cached_units` requires every one of the seven fields to be **truthy** or it discards the entry — so empty strings count as missing, and a single missing field will silently drop a unit at next reload.

5. **Add the integration via HA UI.** Settings → Devices & Services → Add Integration → Kumo, paste Comfort App creds, leave **Prefer cache** checked. With V3-fetched creds + cache-supplied addresses, the merge should succeed and devices should appear.
6. **If only some units appear, append the missing ones to the saved cache and reload.** This is the config-flow gap: `validate_input` constructs `KumoCloudAccount(...)` without `kumo_dict=`, so V3 has no cached IPs, returns 0, falls back to V2, and V2 may only return a subset. The integration writes its own cache after first save, so the fix is to append the missing unit(s) to that on-disk cache (with all seven fields, fresh creds from V3) and **Reload** the integration. On reload, `__init__.py:async_kumo_setup_v3` _does_ pass `kumo_dict=`, so V3 sees cached addresses and merges cleanly.
7. **Set DHCP reservations** for the dongle MACs. The cache stays correct only if IPs don't shuffle. In this homelab:
   - `50:26:ef:29:70:ee` → 192.168.1.173 (Bedroom)
   - `50:26:ef:28:f1:de` → 192.168.1.43 (Living Room)

## Common false trails

What _isn't_ the problem, despite looking like it might be:

- **"Dongle-side password drift requiring physical re-pair."** This was the [2026-04-26 diagnosis](../archive/superseded/2026-04-26_home-assistant-kumo-troubleshooting.md). Wrong; nothing physical was needed in this homelab. Re-pair via "Add Indoor Unit" doesn't hurt but doesn't help either if the actual problem is a stale cache mapping.
- **"V3 API only returning some units."** Almost always a Socket.IO timing artefact — a dongle was briefly offline when the cloud asked it to push its password. Retry V3 a few seconds later. Permanent missing units are usually account-side (a unit registered against a different Comfort account), not bug #209.
- **"`device_authentication_error` means bad creds."** Almost always means the (IP, password) pairing is wrong, not that the creds themselves are wrong. Confirm by probing the same creds against every Murata-OUI IP on the LAN — one of them will accept the password.
- **"Removing and re-adding the integration will refresh things."** It will, but the same first-pass-only-finds-some-units gap will recur: V3 can't see cached IPs, V2 returns a subset, you end up where you started. Better to keep the integration installed and edit the cache + reload.

## Upstream issue

A GitHub issue has been filed upstream against `dlarrick/hass-kumo` proposing that `5026EF*` (Murata Manufacturing) be added to `manifest.json`'s `dhcp` filter array. The issue includes the workaround documented here and a flag that it was AI-investigated. Once accepted, this homelab's adapters will auto-discover on first install, removing the need to pre-populate the cache by hand.

## Hygiene follow-ups

- **DHCP reservations** as listed above.
- **Optional MHK2 entity slug cleanup.** Four legacy MHK2-related entities (`sensor.living_room_sensor_battery`, `sensor.living_room_sensor_signal_strength`, plus `*_2` variants) remain in `core.entity_registry` with `disabled_by: integration`. They have slightly wrong slugs from earlier installs but are invisible until an MHK2 wireless thermostat sensor is paired. If ever pairing one, delete those rows from `core.entity_registry` while HA is stopped so the integration creates them fresh with correct slugs.

## Related

- [Home Assistant Cleanup Followups (2026-04-25)](2026-04-25_home-assistant-cleanup-followups.md) — `litterrobot` reload, Sonos Bedroom Wi-Fi flapping, orphaned-entity cleanup that surfaced alongside the original Kumo investigation.
- [Type-safe Home Assistant Client (2026-04-21)](2026-04-21_type-safe-home-assistant-client.md) — `ha-codegen` and the typed REST client used elsewhere for HA automation.
- [2026-04-26 Kumo troubleshooting (superseded)](../archive/superseded/2026-04-26_home-assistant-kumo-troubleshooting.md) — predecessor doc with the wrong diagnosis, retained for searchability.
