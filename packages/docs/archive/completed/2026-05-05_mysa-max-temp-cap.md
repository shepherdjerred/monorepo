---
id: plan-2026-05-05-mysa-max-temp-cap
type: reference
status: complete
board: true
verification: agent
disposition: active
---

# Mysa HACS integration max-temp cap

## Status Notes (Historical)

Complete (2026-07-03). Resolved via our own fork rather than upstream. Upstream PR #18 was closed unmerged and `kgelinas/Mysa_HA` is stale (no push since 2026-03-22, issue #16 still open), so HA now runs `shepherdjerred/Mysa_HA@v0.9.3` via HACS. `MORNING_HEAT_TEMP_C` raised 30 → 40. Verified live against `homeassistant.tailnet-1a49.ts.net`: `climate.master_bathroom.max_temp == 40`, and a `set_temperature 35 / hvac_mode heat` call returned HTTP 200 and applied (`state: heat`) with no MQTT 1005 error, then was reverted to `off`/30.

## Problem

The `kgelinas/Mysa_HA` HACS integration (v0.9.2) hardcodes `MysaClimate._attr_max_temp = 30.0` and clamps `MysaMaxSetpointNumber._attr_native_max_value = 30.0`. The user's INF-V1-0 floor heater reports a true device max of 40 °C (visible in the Mysa app and in `number.master_bathroom_max_setpoint.state == "40.0"`), but `climate.master_bathroom.max_temp` always returned `30.0`. Any `set_temperature` > 30 °C returned `500 Internal Server Error` from HA.

The `goodMorningEarly` workflow set the master bathroom to 35 °C for an hour starting at 07:00 PT. After deploy, every weekday run failed with 24 retries and timed out, e.g. `good-morning-weekday-early-workflow-2026-05-04T14:00:00Z`.

## Hotfix landed

- `packages/temporal/src/workflows/ha/good-morning.ts:16` — `MORNING_HEAT_TEMP_C` lowered from 35 → 30 with a pointer comment to the upstream issue and PR.
- Workflow goes green at the next 07:00 PT run after the next image deploy.

## The fix (PR #18)

- Issue: [kgelinas/Mysa_HA#16](https://github.com/kgelinas/Mysa_HA/issues/16) (Issue 2: temperature range capped at 30 °C).
- PR: [kgelinas/Mysa_HA#18](https://github.com/kgelinas/Mysa_HA/pull/18) — adds `min_temp` / `max_temp` properties to `MysaClimate` that reuse the multi-key extraction + centidegrees logic from `MysaMin/MaxSetpointNumber.native_value`, and bumps the slider clamps from 30 → 40 on both number entities. 1115 tests pass, 100 % coverage maintained, pylint 10/10.

## Upstream went dead — resolved via fork instead

The upstream never merged #18. Self-closed 2026-06-03 (in a batch cleanup of stale unmerged PRs — no maintainer ever engaged), issue #16 still open, repo untouched since 2026-03-22. So we stopped waiting on upstream and shipped the fix through our own fork:

1. **Fork carries the fix on a release.** The fix branch `fix/expose-device-setpoint-limits` was merged into `main` on `shepherdjerred/Mysa_HA`, `manifest.json` bumped 0.9.2 → 0.9.3, and release [`v0.9.3`](https://github.com/shepherdjerred/Mysa_HA/releases/tag/v0.9.3) cut so HACS sees an installable update > 0.9.2.
2. **HA pinned to the fork.** HACS custom repo repointed to `shepherdjerred/Mysa_HA`; redownloaded 0.9.3 + restarted HA. The Mysa config entry (devices/entities/automations) was preserved — a HACS code update only swaps `custom_components/mysa/`, it doesn't touch HA's registries.
3. **Live verification** (2026-07-03): `climate.master_bathroom.max_temp == 40.0`, `number.master_bathroom_max_setpoint` clamp == 40.0. A `set_temperature 35 / hvac_mode heat` call → HTTP 200, applied (`state: heat`, `temperature: 35`), no MQTT 1005 error in the HA log; reverted to `off`/30 afterward.
4. **Workflow un-capped.** `MORNING_HEAT_TEMP_C` raised 30 → 40 in `packages/temporal/src/workflows/ha/good-morning.ts`, apology comment replaced with a fork pointer.

### Remaining

- After the temporal image with this change deploys, confirm the next weekday 07:00 PT `good-morning` run completes (heat set to 40 °C without retries/timeout).
- Keep the fork alive as HA's HACS source; upstream is effectively abandoned. If upstream ever revives and merges an equivalent, revisit whether to repoint HACS back.
