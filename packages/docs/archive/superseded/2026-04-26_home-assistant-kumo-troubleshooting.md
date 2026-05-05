# Home Assistant — Kumo Integration Troubleshooting

Operational notes from a 2026-04-26 debugging session. The HA `kumo` integration (HACS `dlarrick/hass-kumo`) was firing 500+ warnings/min and starving HA's executor pool, which collaterally cancelled the `litterrobot` config entry on every boot.

## The integration stack

```
HA core ── HACS custom_components/kumo ── pykumo (PyPI) ── HTTP/JSON
                                                          ├─→ Mitsubishi v3 cloud (Comfort App backend)
                                                          └─→ Local kumostat dongle (per-unit, on LAN)
```

- **Account credentials** (`username`/`password` in `core.config_entries`) authenticate to Mitsubishi's v3 cloud and download a per-unit `password` + `cryptoSerial` into `kumo_cache.json`.
- **Per-unit secrets** in `kumo_cache.json` are used to sign every local poll request. The kumostat dongle (192.168.1.x) recomputes the HMAC and rejects mismatches with `{'_api_error': 'device_authentication_error'}`.

Two independent failure surfaces. Account creds being valid (login works in the Comfort app) does **not** imply the per-unit secrets are valid.

## Known-bad version combinations

| Component        | Bad                             | Fixed                                                            |
| ---------------- | ------------------------------- | ---------------------------------------------------------------- |
| `hass-kumo` HACS | ≤ v0.4.2 (pins `pykumo==0.4.0`) | **v0.4.3+** (`pykumo>=0.4.1`)                                    |
| `pykumo`         | 0.4.0                           | **0.4.1+** (PR #65 — preserve cache values when v3 lookup fails) |

`pykumo 0.4.0`'s v3 fetch can clobber a previously-correct `kumo_cache.json` with empty/garbage values. Once corrupted, every poll returns `device_authentication_error` until the cache is wiped and re-fetched on a fixed version.

References: [hass-kumo#189](https://github.com/dlarrick/hass-kumo/issues/189), [hass-kumo#209](https://github.com/dlarrick/hass-kumo/issues/209), [pykumo PR#65](https://github.com/dlarrick/pykumo/pull/65).

## Quick diagnosis

```bash
POD=$(kubectl get pod -n home -o name | grep homeassistant | head -1 | sed 's|pod/||')

# Versions
kubectl exec -n home "$POD" -c main -- sh -c '
  cat /config/custom_components/kumo/manifest.json | grep -E "version|requirements"
  pip show pykumo | grep -E "^(Name|Version)"
'

# Cache state
kubectl exec -n home "$POD" -c main -- sh -c '
  ls -la /config/kumo_cache.json
  python3 -c "import json; print(json.dumps(json.load(open(\"/config/kumo_cache.json\")), indent=2))"
'

# Error rate over last 5 min
kubectl logs -n home "$POD" -c main --since=5m | sed -E "s/\x1b\[[0-9;]*m//g" \
  | awk '/ERROR/{e++} /WARNING/{w++} END{print "errors="e+0, "warnings="w+0}'
```

### Direct adapter probe (verifies whether secrets are bad vs. network issue)

`probe_kumo.py` — copy into the pod, runs pykumo against each cached unit:

```python
import json, time, pykumo
from pykumo import PyKumo

with open("/config/kumo_cache.json") as f:
    cache = json.load(f)

units = []
def walk(x):
    if isinstance(x, dict):
        if "serial" in x and "cryptoSerial" in x:
            units.append(x)
        for v in x.values(): walk(v)
    elif isinstance(x, list):
        for v in x: walk(v)
walk(cache)

for u in units:
    cfg = {"address": u["address"], "password": u["password"], "crypto_serial": u["cryptoSerial"]}
    k = PyKumo(u["label"], u["address"], cfg, None, None)
    t0 = time.time()
    ok = k.update_status()
    print(f"{u['label']} @ {u['address']}: update_status={ok!r} ({time.time()-t0:.1f}s)")
```

ICMP-pingable adapter + `update_status() = False` + log noise of `device_authentication_error` → secrets are bad. Connect-timeout on every endpoint → adapter is offline.

> **Don't probe with `curl http://<adapter_ip>/`** — adapters only answer `PUT /api?m=<token>`. A bare GET hangs to socket timeout; that's normal, not a sign of a broken unit.

### Probe Mitsubishi v3 directly with HA's stored credentials

```python
import json, pykumo
from pykumo import KumoCloudAccount

cfg = json.load(open("/config/.storage/core.config_entries"))
entry = next(e for e in cfg["data"]["entries"] if e["domain"] == "kumo")
acct = KumoCloudAccount.Factory(username=entry["data"]["username"], password=entry["data"]["password"])
acct.try_setup()
for serial in acct.get_indoor_units():
    print(serial, acct.get_name(serial), acct.get_address(serial))
```

If the v3 response is missing units that exist in the Comfort app, that's the v3-API server-side bug (#209). The remediation is on the cloud account, not in HA.

## Fix paths (escalation order)

1. **Update HACS `hass-kumo` to ≥ v0.4.3** in the HA UI (HACS → Kumo → Redownload, enable beta if needed). Bumps pykumo to ≥ 0.4.1 in-process.
2. **Wipe the corrupted cache** so 0.4.1 does a clean fetch:

   ```bash
   kubectl exec -n home "$POD" -c main -- rm /config/kumo_cache.json
   ```

   Then in HA UI: Settings → Devices & Services → Kumo → Reload. (Or restart the pod.)

3. **Delete + re-add the integration** (UI) if Reload doesn't repopulate the cache. Forces a fresh v3 fetch with no `prefer_cache` bias.
4. **Re-add each unit in the Comfort app via "Add Indoor Unit"** without factory-resetting. Re-runs the dongle's pairing flow and writes a fresh password to both the dongle and cloud. Required when the dongle's local password has drifted from cloud (post-move, post-OTA).
5. **Factory-reset each kumostat dongle**. Documented community fix when (4) fails. Loses Wi-Fi credentials on the dongle. Long-press the WPS/reset button until LEDs blink, then re-pair via Comfort app.

The integration's noise can starve HA's executor pool — every `pykumo` poll is a blocking sync HTTP call that occupies a `SyncWorker_*` thread. While Kumo is broken, slow-bootstrap integrations like `litterrobot` (which uses `loop.run_in_executor(None, ...)` for AWS Cognito SRP) can timeout out on stage-2 bootstrap waiting for an executor thread. **Disabling the Kumo integration in HA UI** is a fast way to stabilize the rest of HA while you fix Kumo physically.

## What we found this session

- HACS `hass-kumo` was on v0.4.2 → bumped to **v0.4.3** (released same day, 2026-04-26)
- `pykumo` upgraded **0.4.0 → 0.4.1**
- Wiped `/config/kumo_cache.json`, deleted + re-added integration
- Fresh v3 fetch returned **only one of two registered units** (issue #209 — Mitsubishi-side incomplete `zoneTable` response)
- The one unit it did return still produced `device_authentication_error` on every poll → adapter's local password drifted from cloud's view (the unit was physically moved/re-paired during a residence change, which is a known trigger)
- Resolution requires physical access: re-pair the moved unit's dongle via "Add Indoor Unit" in the Comfort app, and add the second unit to the same Comfort account so it appears in v3

## Related

- [Home Assistant Cleanup Followups](2026-04-25_home-assistant-cleanup-followups.md) — covers the `litterrobot` reload, Sonos Bedroom Wi-Fi flapping, and orphaned-entity cleanup that surfaced alongside this Kumo investigation.
- [Type-safe Home Assistant Client](2026-04-21_type-safe-home-assistant-client.md) — `ha-codegen` and the typed REST client used elsewhere for HA automation.
