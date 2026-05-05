# Mysa HACS integration max-temp cap

## Status

In Progress. Local hotfix landed at 30 °C; upstream PR open and waiting for review/release before we can revert to 35 °C.

## Problem

The `kgelinas/Mysa_HA` HACS integration (v0.9.2) hardcodes `MysaClimate._attr_max_temp = 30.0` and clamps `MysaMaxSetpointNumber._attr_native_max_value = 30.0`. The user's INF-V1-0 floor heater reports a true device max of 40 °C (visible in the Mysa app and in `number.master_bathroom_max_setpoint.state == "40.0"`), but `climate.master_bathroom.max_temp` always returned `30.0`. Any `set_temperature` > 30 °C returned `500 Internal Server Error` from HA.

The `goodMorningEarly` workflow set the master bathroom to 35 °C for an hour starting at 07:00 PT. After deploy, every weekday run failed with 24 retries and timed out, e.g. `good-morning-weekday-early-workflow-2026-05-04T14:00:00Z`.

## Hotfix landed

- `packages/temporal/src/workflows/ha/good-morning.ts:16` — `MORNING_HEAT_TEMP_C` lowered from 35 → 30 with a pointer comment to the upstream issue and PR.
- Workflow goes green at the next 07:00 PT run after the next image deploy.

## Upstream fix

- Issue: [kgelinas/Mysa_HA#16](https://github.com/kgelinas/Mysa_HA/issues/16) (Issue 2: temperature range capped at 30 °C).
- PR: [kgelinas/Mysa_HA#18](https://github.com/kgelinas/Mysa_HA/pull/18) — adds `min_temp` / `max_temp` properties to `MysaClimate` that reuse the multi-key extraction + centidegrees logic from `MysaMin/MaxSetpointNumber.native_value`, and bumps the slider clamps from 30 → 40 on both number entities. 1115 tests pass, 100 % coverage maintained, pylint 10/10.

## Resolution

When `kgelinas/Mysa_HA` ships a release that includes #18 and HACS pulls it through to the homelab HA instance:

1. Bump `MORNING_HEAT_TEMP_C` back to 35 (or higher; device allows up to 40) and remove the apology comment.
2. Verify the next weekday 07:00 PT run completes via `temporal workflow show --address temporal.tailnet-1a49.ts.net:443 --tls --workflow-id good-morning-weekday-early-workflow-<date>T14:00:00Z` (status `Completed`).
3. Archive this plan to `archive/superseded/` and update `index.md`.
