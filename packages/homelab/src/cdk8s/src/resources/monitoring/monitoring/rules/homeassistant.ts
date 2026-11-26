import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { tailnetService } from "homelab/src/platform-model.ts";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { createSensorAlert, escapePrometheusTemplate } from "./shared.ts";

// Every entity a Temporal home automation reads or actuates. Kept in sync with
// packages/temporal/src/workflows/ha by homeassistant.test.ts — an entity added
// to a workflow without a matching entry here would lose its availability alert.
export const TEMPORAL_AUTOMATION_ENTITY_IDS = [
  "scene.bedroom_dimmed",
  "scene.bedroom_bright",
  "light.bedroom",
  "climate.bedroom",
  "climate.master_bathroom",
  "climate.living_room",
  "sensor.master_bathroom_temperature",
  "zone.home",
  "lock.front_door",
  "scene.living_room_bright",
  "switch.light_2",
  "switch.light",
  "media_player.bedroom",
  "media_player.master_bathroom",
  "person.jerred",
  "person.shuxin",
  "sun.sun",
  "vacuum.1st_floor",
  "vacuum.2nd_floor",
  "vacuum.3rd_floor",
] as const;

const masterBathroomTemperatureAvailability =
  'homeassistant_entity_available{entity="sensor.master_bathroom_temperature"}';

// `== 0` only matches an entity Home Assistant still exports. When the Mysa
// integration fails to set up, or the entity leaves the exported state set
// entirely, the series is absent and the comparison yields an empty vector, so
// the `absent()` arm is what catches a total integration failure.
const masterBathroomTemperatureUnavailableExpr = `${masterBathroomTemperatureAvailability} == 0 or absent(${masterBathroomTemperatureAvailability})`;

const ROBOROCK_FLOORS = ["1st", "2nd", "3rd"] as const;

const PET_CARE_ENTITY_IDS = [
  "vacuum.storage_litter_box",
  "sensor.storage_status_code",
  "binary_sensor.storage_bonnet_removed",
  "binary_sensor.storage_drawer_removed",
  "binary_sensor.storage_laser_dirty",
  "binary_sensor.litter_robot_problem",
  "binary_sensor.litter_robot_stalled",
  "binary_sensor.petlibro_living_room_feeder_problem",
  "binary_sensor.petlibro_guest_room_feeder_problem",
  "binary_sensor.petlibro_fountain_water_low",
  "binary_sensor.petlibro_fountain_operation_problem",
  "binary_sensor.dockstream_2_smart_fountain_water_dispensing_state",
  "binary_sensor.dockstream_2_smart_fountain_wi_fi",
  "sensor.dockstream_2_smart_fountain_remaining_cleaning_days",
  "sensor.dockstream_2_smart_fountain_remaining_filter_day",
  "sensor.dockstream_2_smart_fountain_remaining_water",
  "sensor.dockstream_2_smart_fountain_remaining_water_2",
  "select.dockstream_2_smart_fountain_water_dispensing_mode",
  ...["", "_2"].flatMap((suffix) => [
    `sensor.granary_smart_camera_feeder_battery_ac${suffix}`,
    `binary_sensor.granary_smart_camera_feeder_food_dispenser${suffix}`,
    `binary_sensor.granary_smart_camera_feeder_food_status${suffix}`,
    `binary_sensor.granary_smart_camera_feeder_wi_fi${suffix}`,
    `sensor.granary_smart_camera_feeder_desiccant_remaining_days${suffix}`,
    `sensor.granary_smart_camera_feeder_last_feed_time${suffix}`,
  ]),
  ...ROBOROCK_FLOORS.flatMap((floor) => [
    `vacuum.${floor}_floor`,
    `sensor.${floor}_floor_battery`,
    `sensor.${floor}_floor_status`,
    `sensor.${floor}_floor_vacuum_error`,
    `sensor.${floor}_floor_dock_dock_error`,
    `sensor.${floor}_floor_main_brush_time_left`,
    `sensor.${floor}_floor_side_brush_time_left`,
    `sensor.${floor}_floor_filter_time_left`,
    `sensor.${floor}_floor_dock_strainer_time_left`,
    `binary_sensor.${floor}_floor_dock_clean_water_box`,
    `binary_sensor.${floor}_floor_dock_dirty_water_box`,
    `binary_sensor.${floor}_floor_dock_cleaning_fluid`,
    `binary_sensor.${floor}_floor_water_shortage`,
    `binary_sensor.${floor}_floor_vacuum_problem`,
  ]),
] as const;

function roborockChildFloor(
  entity: string,
): (typeof ROBOROCK_FLOORS)[number] | undefined {
  for (const floor of ROBOROCK_FLOORS) {
    if (
      entity.startsWith(`sensor.${floor}_floor_`) ||
      entity.startsWith(`binary_sensor.${floor}_floor_`)
    ) {
      return floor;
    }
  }
  return undefined;
}

function petCareUnavailableExpr(entity: string): string {
  const baseUnavailableExpr = `homeassistant_entity_available{entity="${entity}"} == 0 or absent(homeassistant_entity_available{entity="${entity}"})`;
  const floor = roborockChildFloor(entity);
  return floor === undefined
    ? baseUnavailableExpr
    : `(${baseUnavailableExpr}) and on() (homeassistant_entity_available{entity="vacuum.${floor}_floor"} == 1)`;
}

function friendlyEntityName(entity: string): string {
  const withoutDomain = entity.replace(/^[a-z_]+\./u, "");
  return withoutDomain
    .replace(/^dockstream_2_smart_fountain_/u, "fountain_")
    .replace(/^granary_smart_camera_feeder_(.+)_2$/u, "guest_room_feeder_$1")
    .replace(/^granary_smart_camera_feeder_/u, "living_room_feeder_")
    .replaceAll("_", " ");
}

function expressionAlert(options: {
  name: string;
  expression: string;
  summary: string;
  description: string;
  duration?: string;
  severity?: "warning" | "critical";
}) {
  return {
    alert: options.name,
    annotations: {
      description: escapePrometheusTemplate(options.description),
      summary: options.summary,
    },
    expr: PrometheusRuleSpecGroupsRulesExpr.fromString(options.expression),
    for: options.duration ?? "10m",
    labels: { severity: options.severity ?? "warning" },
  };
}

function feederRules(
  id: "LivingRoom" | "GuestRoom",
  label: string,
  suffix: "" | "_2",
) {
  const prefix = "granary_smart_camera_feeder";
  return [
    createSensorAlert({
      name: `PetLibroFeeder${id}BatteryProblem`,
      entity: `homeassistant_sensor_battery_percent{entity="sensor.${prefix}_battery_ac${suffix}"}`,
      condition: "<=",
      threshold: 20,
      duration: "2h",
      summary: `${label} PetLibro feeder backup battery is low`,
      description: `The ${label} PetLibro feeder D-cell backup battery is at {{ $value }}%, risking missed meals during a power outage. Replace the D-cell backup batteries in the feeder.`,
    }),
    createSensorAlert({
      name: `PetLibroFeeder${id}DesiccantDue`,
      entity: `homeassistant_sensor_duration_d{entity="sensor.${prefix}_desiccant_remaining_days${suffix}"}`,
      condition: "<=",
      threshold: 0,
      description: `The ${label} PetLibro feeder desiccant pack has {{ $value }} days remaining, risking moisture buildup in stored dry food. Replace the desiccant bag and reset the timer in the PetLibro app.`,
      summary: `${label} PetLibro feeder desiccant is due`,
      duration: "1h",
    }),
  ];
}

/**
 * Physical household chores and appliance faults carry `category: "household"`
 * and hold firing across brief `Recreate` pod restarts of `homeassistant` or
 * `trmnl-dashboard`. Software, telemetry, and integration availability alerts
 * omit `category: "household"` so they route and triage as Ops incidents.
 * Recording rules keep their series labels unchanged.
 */
export const HOME_ASSISTANT_ALERT_CATEGORY = "household";
export const HOME_ASSISTANT_KEEP_FIRING_FOR = "15m";

export const HOME_ASSISTANT_OPS_ALERT_NAMES: ReadonlySet<string> = new Set([
  "HomeAssistantAutomationDependencyUnavailable",
  "PetCareEntityUnavailable",
  "LitterRobotDiagnosticsStale",
  "LitterRobotEntitiesStale",
]);

export function getHomeAssistantRuleGroups(): PrometheusRuleSpecGroups[] {
  return getUncategorizedHomeAssistantRuleGroups().map((group) => ({
    ...group,
    rules: group.rules?.map((rule) =>
      rule.alert === undefined || HOME_ASSISTANT_OPS_ALERT_NAMES.has(rule.alert)
        ? rule
        : {
            ...rule,
            keepFiringFor: HOME_ASSISTANT_KEEP_FIRING_FOR,
            labels: {
              ...rule.labels,
              category: HOME_ASSISTANT_ALERT_CATEGORY,
            },
          },
    ),
  }));
}

function getUncategorizedHomeAssistantRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "homeassistant-petlibro-fountain",
      rules: [
        createSensorAlert({
          name: "PetLibroFountainCleaningDue",
          entity:
            'homeassistant_sensor_duration_d{entity="sensor.dockstream_2_smart_fountain_remaining_cleaning_days"}',
          condition: "<=",
          threshold: 0,
          description:
            "The PetLibro Dockstream 2 water fountain has {{ $value }} cleaning days remaining, risking biofilm buildup in pet drinking water. Clean the fountain tank and pump, then reset the cleaning timer in the PetLibro app.",
          summary: "PetLibro fountain cleaning is due",
        }),
        createSensorAlert({
          name: "PetLibroFountainFilterDue",
          entity:
            'homeassistant_sensor_duration_d{entity="sensor.dockstream_2_smart_fountain_remaining_filter_day"}',
          condition: "<=",
          threshold: 0,
          description:
            "The PetLibro Dockstream 2 water fountain filter has {{ $value }} days remaining, reducing water filtration quality. Replace the fountain filter and sponge, then reset the filter timer in the PetLibro app.",
          summary: "PetLibro fountain filter replacement is due",
        }),
      ],
    },
    {
      name: "homeassistant-petlibro-feeders",
      rules: [
        ...feederRules("LivingRoom", "Living Room", ""),
        ...feederRules("GuestRoom", "Guest Room", "_2"),
      ],
    },
    {
      name: "homeassistant-litter-robot",
      rules: [
        createSensorAlert({
          name: "LitterRobotLitterLow",
          entity: "max by (namespace) (trmnl_petcare_litter_percent)",
          condition: "<",
          threshold: 60,
          description:
            "The storage room Litter-Robot 5 globe litter level is {{ $value }}% (below 60%), which can degrade clumping and cycle cleanliness. Refill the globe or top up the LitterHopper with fresh litter.",
          summary: "Storage Litter-Robot 5 globe litter is low",
        }),
        expressionAlert({
          name: "LitterRobotWasteHigh",
          expression:
            "max by (namespace) (trmnl_petcare_litter_waste_percent) > 60 and max by (namespace) (trmnl_petcare_litter_waste_percent) <= 80",
          description:
            "The storage room Litter-Robot 5 waste drawer is {{ $value }}% full and approaching capacity. Empty the waste drawer liner soon so automatic cycling does not pause.",
          summary: "Storage Litter-Robot 5 waste drawer is over 60% full",
          duration: "30m",
        }),
        createSensorAlert({
          name: "LitterRobotWasteCritical",
          entity: "max by (namespace) (trmnl_petcare_litter_waste_percent)",
          condition: ">",
          threshold: 80,
          description:
            "The storage room Litter-Robot 5 waste drawer is {{ $value }}% full (over 80%) and about to stop automatic cleaning cycles. Replace the waste drawer bag promptly and confirm the drawer resets.",
          summary: "Storage Litter-Robot 5 waste drawer is nearly full",
          duration: "10m",
          severity: "critical",
        }),
        // Hopper and robot fault rules read statuses the exporter keeps at
        // their last known values when Whisker stops answering, so without the
        // freshness gate they report a snapshot as if it were current — a fault
        // the device may have long since cleared, paged indefinitely.
        // `LitterRobotDiagnosticsStale` below already owns the stale source, so
        // gating here reports the condition once rather than twice.
        expressionAlert({
          name: "LitterRobotHopperLowOrDisconnected",
          expression:
            'max by (namespace) (trmnl_petcare_litter_hopper_status{status=~"low|empty|disconnected|unknown"}) == 1 and on (namespace) max by (namespace) (trmnl_petcare_litter_source_fresh) == 1',
          description:
            "The storage room Litter-Robot 5 LitterHopper is low, empty, disconnected, or reporting an unknown status, preventing automatic litter refills. Refill the hopper and check that it is seated and connected in the Whisker app.",
          summary: "Storage Litter-Robot 5 hopper is low or disconnected",
        }),
        expressionAlert({
          name: "LitterRobotHopperFault",
          expression:
            'max by (namespace) (trmnl_petcare_litter_hopper_status{status=~"jammed|motor-fault|fault"}) == 1 and on (namespace) max by (namespace) (trmnl_petcare_litter_source_fresh) == 1',
          description:
            "The storage room Litter-Robot 5 LitterHopper is reporting a jam or motor fault, stopping automatic globe refills. Inspect the hopper dispense chute for obstructions, reseat the hopper, and clear the fault on the unit or Whisker app.",
          summary: "Storage Litter-Robot 5 hopper has a fault",
          severity: "critical",
          duration: "5m",
        }),
        expressionAlert({
          name: "LitterRobotFault",
          expression:
            'max by (namespace) (trmnl_petcare_litter_fault == 1 or trmnl_petcare_litter_online == 0 or trmnl_petcare_litter_hopper_installed == 0 or trmnl_petcare_litter_hopper_enabled == 0) and on (namespace) max by (namespace) (trmnl_petcare_litter_source_fresh) == 1 unless on () (max(homeassistant_binary_sensor_state{entity="binary_sensor.litter_robot_problem"}) == 1)',
          description:
            "The storage room Litter-Robot 5 has reported a hardware fault, dirty laser sensor, removed bonnet or drawer, offline status, or disabled hopper for 15 minutes. Inspect the unit and Whisker app diagnostics to clear obstructions, clean the sensors, or restore Wi-Fi.",
          summary: "Storage Litter-Robot 5 has a hardware or offline fault",
          duration: "15m",
        }),
        // Whisker device lastSeen is not a live heartbeat, so freshness tracks successful API fetches.
        expressionAlert({
          name: "LitterRobotDiagnosticsStale",
          expression:
            'trmnl_petcare_source_up{source="whisker"} == 0 or trmnl_petcare_litter_source_fresh == 0 or absent(trmnl_petcare_litter_source_fresh) or time() - trmnl_petcare_whisker_last_success_timestamp_seconds > 900 or absent(trmnl_petcare_whisker_last_success_timestamp_seconds)',
          description:
            "Validated Whisker API diagnostics for the storage room Litter-Robot 5 have not succeeded in over 15 minutes, blinding fault and waste-level alerts. Check the trmnl-dashboard petcare exporter logs, Whisker API credentials, and Home Assistant entity availability.",
          summary: "Storage Litter-Robot 5 Whisker diagnostics are stale",
          duration: "10m",
        }),
        expressionAlert({
          name: "LitterRobotEntitiesStale",
          expression:
            "trmnl_petcare_litter_ha_mismatch == 1 or absent(trmnl_petcare_litter_ha_mismatch)",
          description:
            "Home Assistant's Litter-Robot 5 entities have disagreed with fresh Whisker API diagnostics for 10 minutes, leaving HA dashboards and automations with stale state. Reload the Whisker integration in Home Assistant and check Home Assistant logs for API errors.",
          summary:
            "Storage Litter-Robot 5 Home Assistant state disagrees with Whisker",
          duration: "10m",
        }),
        expressionAlert({
          name: "LitterRobotFilterOverdue",
          expression:
            "time() > max by (namespace) (trmnl_petcare_litter_filter_due_timestamp_seconds)",
          description:
            "The storage room Litter-Robot 5 carbon filter is past its replacement date, reducing odor control. Replace the carbon filter in the globe pocket and reset the filter timer in the Whisker app.",
          summary:
            "Storage Litter-Robot 5 carbon filter replacement is overdue",
          duration: "1h",
        }),
      ],
    },

    // Entity availability monitoring
    {
      name: "homeassistant-availability",
      rules: [
        // The command actor is not inferred from Home Assistant recorder history; no automatic restart is attempted.
        {
          alert: "VacuumRunInterrupted",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'max by (workflow, reason) (temporal_workflow_outcome_last_timestamp_seconds{workflow=~"runVacuumIfNotHome|leavingHome",outcome="interrupted",reason="commanded-return"}) > time() - 86400',
          ),
          for: "1m",
          labels: { severity: "info" },
          annotations: {
            summary: "Vacuum cleaning interrupted by a return command",
            description: escapePrometheusTemplate(
              "A scheduled Roborock cleaning run in Temporal workflow {{ $labels.workflow }} was interrupted by a return-to-base command within the last 24 hours, leaving the floor partially cleaned. Check Home Assistant history if the return was unexpected and start a manual cleaning run if needed.",
            ),
          },
        },
        {
          alert: "HomeAssistantMasterBathroomTemperatureUnavailable",
          annotations: {
            description:
              "The Mysa master bathroom temperature sensor has been unavailable or missing from Home Assistant for 15 minutes, preventing the morning routine from turning on floor heat (scheduled turn-off still runs). Check the Mysa thermostat Wi-Fi connection and the Mysa/HomeKit integration in Home Assistant.",
            summary: "Master bathroom temperature sensor is unavailable",
            runbook_url: `${tailnetService("homeassistant").origin}/history?entity_id=sensor.master_bathroom_temperature`,
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            masterBathroomTemperatureUnavailableExpr,
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
        {
          record: "homeassistant:unavailable_entities_total",
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            "count(homeassistant_entity_available == 0) or vector(0)",
          ),
        },
        ...TEMPORAL_AUTOMATION_ENTITY_IDS.map((entity) => ({
          alert: "HomeAssistantAutomationDependencyUnavailable",
          annotations: {
            description: `Home Assistant entity ${entity}, required by a Temporal home automation workflow, has been unavailable or missing from metrics for 15 minutes and may degrade scheduled routines. Check the device connection and its integration status in Home Assistant.`,
            summary: `Home automation device unavailable: ${friendlyEntityName(entity)}`,
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `homeassistant_entity_available{entity="${entity}"} == 0 or absent(homeassistant_entity_available{entity="${entity}"})`,
          ),
          for: "15m",
          labels: { severity: "warning", entity },
        })),
        ...PET_CARE_ENTITY_IDS.map((entity) => ({
          alert: "PetCareEntityUnavailable",
          annotations: {
            description: `Home Assistant pet-care entity ${entity} has been unavailable or missing from metrics for 15 minutes, leaving pet device monitoring incomplete. Check the device power, Wi-Fi connection, and its Home Assistant integration.`,
            summary: `Pet sensor unavailable: ${friendlyEntityName(entity)}`,
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            petCareUnavailableExpr(entity),
          ),
          for: "15m",
          labels: { severity: "warning", entity },
        })),
      ],
    },

    // Battery monitoring
    {
      name: "homeassistant-batteries",
      rules: [
        // General battery alert. The Roborock floor vacuums and PetLibro feeder
        // D-cell backup batteries are excluded here — they're governed by
        // RoborockBatteryLowNotCharging and PetLibroFeeder*BatteryProblem
        // respectively so they do not double-page.
        createSensorAlert({
          name: "HomeAssistantBatteryLow",
          entity:
            'min by (entity) (homeassistant_sensor_battery_percent{entity!~"sensor[.](1st|2nd|3rd)_floor_battery",entity!~"sensor[.]granary_smart_camera_feeder_battery_ac(_2)?",entity!~".*blue_pure.*filter.*"})',
          condition: "<",
          threshold: 20, // Lowered from 30 to reduce flapping - 20% is genuinely critical
          description:
            "Home Assistant entity {{ $labels.entity }} has {{ $value }}% battery remaining (below 20%), risking device drop-off. Replace or recharge the device battery.",
          summary: "Smart home device battery is below 20%",
          duration: "2h",
        }),
      ],
    },

    // Roborock Saros 10R fleet health (3 units — 1st/2nd/3rd floor). One rule
    // per condition, regex-matched across all three; the offending unit is named
    // via friendly_name. severity:warning reaches the Alerts webhook through
    // Alertmanager's severity route. Metric names + the enum→binary bridges (*_vacuum_problem template
    // sensors) were verified live against HA's /api/prometheus.
    {
      name: "homeassistant-roborock",
      rules: [
        // Stuck / robot error / dock error, via the device_class:problem template
        // binary_sensors that collapse the status/vacuum_error/dock_dock_error
        // enums (which carry no numeric metric) to a boolean.
        createSensorAlert({
          name: "RoborockVacuumProblem",
          entity:
            'homeassistant_binary_sensor_state{entity=~"binary_sensor[.](1st|2nd|3rd)_floor_vacuum_problem"}',
          condition: "==",
          threshold: 1,
          description:
            "Roborock {{ $labels.friendly_name }} has reported a stuck state, robot error, or dock fault for 5 minutes, halting floor cleaning. Inspect the vacuum and dock physically and check the Roborock or Home Assistant app for the specific error.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} reports a problem",
          ),
          duration: "5m",
        }),
        createSensorAlert({
          name: "RoborockDirtyWaterTankFull",
          entity:
            'homeassistant_binary_sensor_state{entity=~"binary_sensor[.](1st|2nd|3rd)_floor_dock_dirty_water_box"}',
          condition: "==",
          threshold: 1,
          description:
            "Roborock {{ $labels.friendly_name }} dock dirty-water tank is full, preventing dock mop washing and mopping runs. Empty and rinse the dirty-water tank on the dock.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} dirty-water tank is full",
          ),
          duration: "5m",
        }),
        createSensorAlert({
          name: "RoborockCleanWaterTankEmpty",
          entity:
            'homeassistant_binary_sensor_state{entity=~"binary_sensor[.](1st|2nd|3rd)_floor_dock_clean_water_box"}',
          condition: "==",
          threshold: 1,
          description:
            "Roborock {{ $labels.friendly_name }} dock clean-water tank has been empty for 15 minutes, preventing mop washing and floor mopping. Refill the dock clean-water tank.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} clean-water tank is empty",
          ),
          duration: "15m",
        }),
        createSensorAlert({
          name: "RoborockCleaningFluidLow",
          entity:
            'homeassistant_binary_sensor_state{entity=~"binary_sensor[.](1st|2nd|3rd)_floor_dock_cleaning_fluid"}',
          condition: "==",
          threshold: 1,
          description:
            "Roborock {{ $labels.friendly_name }} dock cleaning solution reservoir is low, so mopping runs will use plain water once depleted. Refill the dock cleaning fluid cartridge.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} cleaning fluid is low",
          ),
          duration: "5m",
        }),
        createSensorAlert({
          name: "RoborockWaterShortage",
          entity:
            'homeassistant_binary_sensor_state{entity=~"binary_sensor[.](1st|2nd|3rd)_floor_water_shortage"}',
          condition: "==",
          threshold: 1,
          description:
            "Roborock {{ $labels.friendly_name }} reports an onboard or dock water shortage, stopping wet mopping. Check that the dock clean-water tank is filled and properly seated.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} has a water shortage",
          ),
          duration: "5m",
        }),
        // Consumables (main/side brush, filter, dock strainer) — the friendly_name
        // identifies which consumable on which unit. Threshold is hours of life
        // left; tune as desired.
        createSensorAlert({
          name: "RoborockConsumableDue",
          entity:
            'homeassistant_sensor_duration_h{entity=~"sensor[.](1st|2nd|3rd)_floor_(main_brush|side_brush|filter|dock_strainer)_time_left"}',
          condition: "<",
          threshold: 10,
          description:
            "Roborock consumable {{ $labels.friendly_name }} has {{ $value | humanize }} hours of service life remaining (under 10 hours). Clean or replace the worn part and reset its consumable timer in the Roborock or Home Assistant app.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} maintenance is due",
          ),
          duration: "1h",
        }),
        // Battery low AND not charging. Self-join on the same battery series: a
        // cross-entity join to the *_charging binary_sensor never matches (the
        // `entity` label value differs), so use gauge-safe delta() to require the
        // battery to be non-increasing over 30m.
        {
          alert: "RoborockBatteryLowNotCharging",
          annotations: {
            description: escapePrometheusTemplate(
              "Roborock {{ $labels.friendly_name }} battery is at {{ $value }}% and has not gained charge over the last 30 minutes, risking the robot powering off away from its dock. Return the vacuum to its dock and clean the charging contacts if it fails to charge.",
            ),
            summary: escapePrometheusTemplate(
              "Roborock {{ $labels.friendly_name }} battery is low and not charging",
            ),
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'homeassistant_sensor_battery_percent{entity=~"sensor[.](1st|2nd|3rd)_floor_battery"} < 20 and delta(homeassistant_sensor_battery_percent{entity=~"sensor[.](1st|2nd|3rd)_floor_battery"}[30m]) <= 0',
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
