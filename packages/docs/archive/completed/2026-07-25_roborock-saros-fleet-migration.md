---
id: plan-2026-07-25-roborock-saros-fleet-migration
type: plan
status: complete
board: false
---

# Roborock Saros 10R (×3) — Home Assistant + Apple Home (Matter) Migration

Mirror of the approved harness plan (`~/.claude/plans/let-s-do-this-tender-dragon.md`).

## Context

Retired a Roomba + Roborock Q7 Max (both referenced across Temporal workflows and
Prometheus alert rules); now three **Roborock Saros 10R**, one per floor. Goals:
full HA features via the Roborock integration (installed, all 3 live); native Apple
Home tiles via each unit's Matter 1.4 (**already paired**, verified via hkctl);
rename HA entity IDs to floor; retarget the existing Temporal automation off the old
vacuums (no new HA scripts/automations); PagerDuty alerts for robot/dock health.

HA config, Prometheus rules, and Temporal workflows are source-controlled here; Apple
Home is read/written via `sandbox/poc/hkctl`. Everything is agent-doable up to the PR
merge (the human gate).

## Live state — verified

**HA (`admin@torvalds`):** 3 Saros online, `docked`. Entity IDs mismatch floors:

| Current              | Friendly  | Rename to          | Child prefix      |
| -------------------- | --------- | ------------------ | ----------------- |
| `vacuum.office`      | 1st Floor | `vacuum.1st_floor` | `*.office_*`      |
| `vacuum.living_room` | 2nd floor | `vacuum.2nd_floor` | `*.living_room_*` |
| `vacuum.3rd_floor`   | 3rd floor | keep               | `*.3rd_floor_*`   |

**Metrics (verified live at `/api/prometheus`):** `homeassistant_binary_sensor_state`
(1/0); `homeassistant_sensor_battery_percent{…_battery}`;
`homeassistant_sensor_duration_h{…_(main_brush|side_brush|filter|dock_strainer)_time_left}`;
`homeassistant_sensor_state{…_total_cleaning_count}`. Enum sensors (`_status`,
`_vacuum_error`, `_dock_dock_error`) + `vacuum.*` export NO value metric. Dock/water
binary_sensors are `device_class: problem` (`== 1` = problem).

**Apple Home "Meta House":** 3 native Matter tiles (`roborock.vacuum.a144`, already
paired, mis-roomed in "Office"); 3 duplicate HA-bridged switch tiles; a Litter Box
(Whisker, not wanted in HomeKit).

## Phases

- **A (live, agent):** rename entity IDs by device_id (pre-check targets free); hkctl
  HomeKit tidy (never `removeAccessories` a reachable tile).
- **B (`packages/homelab`):** drop `vacuum` from HA1 `include_domains`; delete dead
  roomba lines; glob-exclude Saros diagnostic sensors; add D1 template binary_sensors;
  add stakater Reloader annotation to the HA deployment (subPath ConfigMap does not
  hot-reload).
- **C (`packages/temporal`):** shared `VACUUMS` in util.ts; fleet-iterate + **concurrent
  verify** in run-vacuum-if-not-home (sequential 3× blows the 15-min timeout + breaks
  register-schedules.test.ts); shared VACUUMS in leaving/welcome-home; de-Roomba the
  notification; sync `temporal.ts` benignSkipReasons with any new skip reason.
- **D (`packages/homelab`):** `homeassistant-roborock` PrometheusRule group (stuck via
  D1 template, dock water/fluid, battery **self-series** not-charging, consumables);
  remove dead Roomba rules + fix `HomeAssistantBatteryLow` exclusion; remove dead
  `ha-workflows.ts` HaRoombaVerificationFailed + HaVacuumWorkflowMissing (dead
  `ha_workflow_*` family). severity `warning` → auto-pages.
- **E (`packages/docs`):** supersede the HAMH plan; update ha-integration-reauth.md;

## Sequencing

A (rename) before C merges; A and B close together (HomeKit collision window); B/D
take effect only after the config reload.

## Open validations (live, before shipping D)

- Exact `sensor.<f>_status` enum strings that mean stuck/error.
- Physically confirm the 4 dock/water sensor polarities flip to 1 on fault.
- Consumable IDs + `duration_h` — confirmed live.

## Historical follow-up state

- [x] Phase B — HomeKit config + config-hash rollout
- [x] Phase C — Temporal fleet retarget
- [x] Phase D — Prometheus alerts + template sensors
- [x] Phase E — docs reconciliation
- [x] Verify + draft PR (#1645)
- [x] Phase A — live HA entity rename (done 2026-07-25; 98 entities)
- Post-deploy: full alert dry-run + hkctl before/after (after PR merges + HA rolls)
