---
id: plan-2026-07-25-roborock-saros-fleet-migration
type: plan
status: in-progress
board: true
verification: agent
disposition: active
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
  todo for the `ha_workflow_*` orphan; session log.

## Sequencing

A (rename) before C merges; A and B close together (HomeKit collision window); B/D
take effect only after the config reload.

## Open validations (live, before shipping D)

- Exact `sensor.<f>_status` enum strings that mean stuck/error.
- Physically confirm the 4 dock/water sensor polarities flip to 1 on fault.
- Consumable IDs + `duration_h` — confirmed live.

## Remaining

- [x] Phase B — HomeKit config + config-hash rollout
- [x] Phase C — Temporal fleet retarget
- [x] Phase D — Prometheus alerts + template sensors
- [x] Phase E — docs reconciliation
- [x] Verify + draft PR (#1645)
- [x] Phase A — live HA entity rename (done 2026-07-25; 98 entities)
- [ ] Post-deploy: full alert dry-run + hkctl before/after (after PR merges + HA rolls)

## Session Log — 2026-07-25

### Done

- **Draft PR #1645** (`feature/roborock-saros-fleet`).
- **Temporal** (`workflows/ha/`): shared `VACUUMS` + `startEligibleVacuums()` in
  util.ts; `run-vacuum-if-not-home` iterates the fleet with concurrent verify;
  leaving/welcome-home use the shared helper; `all-units-active` skip reason +
  `temporal.ts` benignSkipReasons synced. 628 tests green.
- **HomeKit/config**: dropped the `vacuum` domain from HA1; deleted dead roomba
  lines; glob-excluded Saros diagnostics; 3 `*_vacuum_problem` template
  binary_sensors (enum→boolean, values verified live); deterministic config-hash
  pod annotation for auto-rollout.
- **Alerts**: `homeassistant-roborock` group (stuck/dock/battery/consumables);
  removed dead Roomba + `ha_workflow_*` rules; fixed the general battery exclusion.
  241 cdk8s tests green; rendering confirmed.
- **Docs**: this plan, `ha-workflow-metrics-orphan` todo, HAMH plan superseded,
  reauth todo updated.
- **Phase A — live HA entity rename (done):** platform-scoped
  (`platform === "roborock"`) so it caught BOTH the vacuum device AND its separate
  dock device — device-scoping had missed the dock's `*_dock_*` entities. 98
  entities renamed: `office_* → 1st_floor_*`, `living_room_* → 2nd_floor_*`
  (3rd_floor already correct). Verified: all alert-referenced IDs resolve; old IDs
  gone; friendly names intact; the `sensor.office_energy/_power` energy monitor
  (different integration) untouched.
- **Codex review remediation:** fleet state inspection now distinguishes active,
  startable, and anomalous units before sending commands; anomalous states and
  failed post-start verification terminate the Temporal workflow instead of
  recording a benign/executed outcome. Expected HA entities now report
  `unknown`/`unavailable` as a problem, and the low-battery rule uses
  gauge-safe `delta()` rather than counter-only `increase()`. Added focused
  Temporal workflow and Home Assistant rule/config regression tests.

### Remaining

- **Post-deploy (after PR merges → ArgoCD → HA rolls via the config-hash annotation):**
  - Full alert dry-run: drive each `*_vacuum_problem` template sensor + the 4
    dock/water binary_sensors to a fault; confirm the metric flips to 1.
  - `hkctl` before/after: the 3 duplicate bridged tiles + Litter Box gone; the 3
    native Matter tiles remain.
- **Optional:** hkctl tidy (move native tiles out of "Office", normalize names).

### Caveats

- The rename lives in HA `.storage`, NOT git — an HA rebuild/PVC-restore reverts the
  entity IDs and silently breaks the D2 rules (empty matches). Mapping: every
  Roborock `office_*` → `1st_floor_*`, `living_room_*` → `2nd_floor_*` (vacuum +
  dock devices).
- Rename→deploy gap: until this PR deploys, the still-live `vacuum` domain
  re-bridges the renamed units as duplicate switch tiles in Apple Home (cosmetic).
- Broader `ha_workflow_*` orphan (non-vacuum rules + dashboard) deferred to
  `ha-workflow-metrics-orphan`.
