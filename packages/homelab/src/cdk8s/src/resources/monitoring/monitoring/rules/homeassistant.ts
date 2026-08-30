import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import {
  createSensorAlert,
  createBinarySensorAlert,
  escapePrometheusTemplate,
} from "./shared.ts";

// Every entity a Temporal home automation reads or actuates. Kept in sync with
// packages/temporal/src/workflows/ha by homeassistant.test.ts — an entity added
// to a workflow without a matching entry here would lose its availability alert.
export const TEMPORAL_AUTOMATION_ENTITY_IDS = [
  "scene.bedroom_dimmed",
  "scene.bedroom_bright",
  "light.bedroom",
  "climate.bedroom",
  "climate.master_bathroom",
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

const PET_CARE_ENTITY_IDS = [
  "binary_sensor.dockstream_2_smart_fountain_water_dispensing_state",
  "binary_sensor.dockstream_2_smart_fountain_wi_fi",
  "sensor.dockstream_2_smart_fountain_remaining_cleaning_days",
  "sensor.dockstream_2_smart_fountain_remaining_filter_day",
  "sensor.dockstream_2_smart_fountain_remaining_water_2",
  "select.dockstream_2_smart_fountain_water_dispensing_mode",
  ...["", "_2"].flatMap((suffix) => [
    `binary_sensor.granary_smart_camera_feeder_battery_status${suffix}`,
    `binary_sensor.granary_smart_camera_feeder_food_dispenser${suffix}`,
    `binary_sensor.granary_smart_camera_feeder_food_status${suffix}`,
    `binary_sensor.granary_smart_camera_feeder_wi_fi${suffix}`,
    `sensor.granary_smart_camera_feeder_desiccant_remaining_days${suffix}`,
    `sensor.granary_smart_camera_feeder_last_feed_time${suffix}`,
  ]),
  ...["1st", "2nd", "3rd"].flatMap((floor) => [
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
    createBinarySensorAlert({
      name: `PetLibroFeeder${id}FoodLow`,
      entity: `binary_sensor.${prefix}_food_status${suffix}`,
      description: `${label} PetLibro feeder reports low food.`,
      summary: `${label} PetLibro feeder food low`,
    }),
    createBinarySensorAlert({
      name: `PetLibroFeeder${id}DispenserProblem`,
      entity: `binary_sensor.${prefix}_food_dispenser${suffix}`,
      description: `${label} PetLibro feeder reports a dispenser failure.`,
      summary: `${label} PetLibro feeder dispenser problem`,
    }),
    createBinarySensorAlert({
      name: `PetLibroFeeder${id}BatteryProblem`,
      entity: `binary_sensor.${prefix}_battery_status${suffix}`,
      description: `${label} PetLibro feeder reports a battery problem.`,
      summary: `${label} PetLibro feeder battery problem`,
    }),
    expressionAlert({
      name: `PetLibroFeeder${id}WifiDisconnected`,
      expression: `homeassistant_binary_sensor_state{entity="binary_sensor.${prefix}_wi_fi${suffix}"} == 0`,
      description: `${label} PetLibro feeder Wi-Fi is disconnected.`,
      summary: `${label} PetLibro feeder offline`,
      duration: "5m",
    }),
    createSensorAlert({
      name: `PetLibroFeeder${id}DesiccantDue`,
      entity: `homeassistant_sensor_duration_d{entity="sensor.${prefix}_desiccant_remaining_days${suffix}"}`,
      condition: "<=",
      threshold: 0,
      description: `${label} PetLibro feeder desiccant is due: {{ $value }} days remaining.`,
      summary: `${label} PetLibro feeder desiccant due`,
      duration: "1h",
    }),
    expressionAlert({
      name: `PetLibroFeeder${id}NotDispensing`,
      expression: `time() - homeassistant_sensor_timestamp_seconds{entity="sensor.${prefix}_last_feed_time${suffix}"} > 50400`,
      description: `${label} PetLibro feeder has not dispensed food in over 14 hours.`,
      summary: `${label} PetLibro feeder not dispensing`,
      duration: "30m",
    }),
  ];
}

export function getHomeAssistantRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    {
      name: "homeassistant-petlibro-fountain",
      rules: [
        createSensorAlert({
          name: "PetLibroFountainWaterLow",
          entity:
            'homeassistant_sensor_unit_percent{entity="sensor.dockstream_2_smart_fountain_remaining_water_2"}',
          condition: "<",
          threshold: 60,
          description: "PetLibro fountain water is below 60%: {{ $value }}%.",
          summary: "PetLibro fountain water low",
        }),
        createSensorAlert({
          name: "PetLibroFountainCleaningDue",
          entity:
            'homeassistant_sensor_duration_d{entity="sensor.dockstream_2_smart_fountain_remaining_cleaning_days"}',
          condition: "<=",
          threshold: 0,
          description:
            "PetLibro fountain cleaning is due: {{ $value }} days remaining.",
          summary: "PetLibro fountain cleaning due",
        }),
        createSensorAlert({
          name: "PetLibroFountainFilterDue",
          entity:
            'homeassistant_sensor_duration_d{entity="sensor.dockstream_2_smart_fountain_remaining_filter_day"}',
          condition: "<=",
          threshold: 0,
          description:
            "PetLibro fountain filter is due: {{ $value }} days remaining.",
          summary: "PetLibro fountain filter due",
        }),
        createBinarySensorAlert({
          name: "PetLibroFountainOperationProblem",
          entity: "binary_sensor.petlibro_fountain_operation_problem",
          description:
            "PetLibro fountain is offline, not in Flowing Water (Constant) mode, or has not dispensed for five minutes.",
          summary: "PetLibro fountain operation problem",
          duration: "5m",
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
          entity: "trmnl_petcare_litter_percent",
          condition: "<",
          threshold: 60,
          description: "LR5 globe litter is below 60%: {{ $value }}%.",
          summary: "Storage LR5 globe litter low",
        }),
        expressionAlert({
          name: "LitterRobotWasteHigh",
          expression:
            "trmnl_petcare_litter_waste_percent > 60 and trmnl_petcare_litter_waste_percent <= 80",
          description: "LR5 waste drawer is above 60%: {{ $value }}%.",
          summary: "Storage LR5 waste drawer high",
          duration: "30m",
        }),
        createSensorAlert({
          name: "LitterRobotWasteCritical",
          entity: "trmnl_petcare_litter_waste_percent",
          condition: ">",
          threshold: 80,
          description: "LR5 waste drawer is above 80%: {{ $value }}%.",
          summary: "Storage LR5 waste drawer critical",
          duration: "10m",
          severity: "critical",
        }),
        expressionAlert({
          name: "LitterRobotHopperLowOrDisconnected",
          expression:
            'trmnl_petcare_litter_hopper_status{status=~"low|empty|disconnected|unknown"} == 1',
          description:
            "LR5 hopper is low, empty, disconnected, or reporting an unknown state.",
          summary: "Storage LR5 hopper needs attention",
        }),
        expressionAlert({
          name: "LitterRobotHopperFault",
          expression:
            'trmnl_petcare_litter_hopper_status{status=~"jammed|motor-fault|fault"} == 1',
          description: "LR5 hopper reports a jam or explicit fault.",
          summary: "Storage LR5 hopper fault",
          severity: "critical",
          duration: "5m",
        }),
        expressionAlert({
          name: "LitterRobotFault",
          expression:
            "trmnl_petcare_litter_fault == 1 or trmnl_petcare_litter_online == 0 or trmnl_petcare_litter_hopper_installed == 0 or trmnl_petcare_litter_hopper_enabled == 0",
          description:
            "LR5 reports a robot fault, dirty laser, removed bonnet/drawer, offline state, or disabled/missing hopper.",
          summary: "Storage LR5 fault",
          duration: "5m",
        }),
        expressionAlert({
          name: "LitterRobotDiagnosticsStale",
          expression:
            'trmnl_petcare_source_up{source="whisker"} == 0 or trmnl_petcare_litter_source_fresh == 0 or absent(trmnl_petcare_litter_source_fresh)',
          description:
            "Fresh Whisker diagnostics are unavailable or the LR5 has not been seen for 15 minutes.",
          summary: "Storage LR5 diagnostics stale",
          duration: "10m",
        }),
        expressionAlert({
          name: "LitterRobotEntitiesStale",
          expression:
            "trmnl_petcare_litter_ha_mismatch == 1 or absent(trmnl_petcare_litter_ha_mismatch)",
          description:
            "Ordinary Home Assistant LR5 entities disagree with fresh Whisker diagnostics.",
          summary: "Storage LR5 Home Assistant entities stale",
          duration: "10m",
        }),
        expressionAlert({
          name: "LitterRobotFilterOverdue",
          expression:
            "time() > trmnl_petcare_litter_filter_due_timestamp_seconds",
          description: "The LR5 filter replacement date has passed.",
          summary: "Storage LR5 filter overdue",
          duration: "1h",
        }),
      ],
    },

    // Entity availability monitoring
    {
      name: "homeassistant-availability",
      rules: [
        {
          alert: "HomeAssistantMasterBathroomTemperatureUnavailable",
          annotations: {
            description:
              "The Mysa master bathroom temperature sensor has been unavailable, or missing from Home Assistant entirely, for 15 minutes. Floor-heat decisions are degraded; the morning wake routine will continue without activating heat, but still runs its end-of-window thermostat turn-off.",
            summary: "Master bathroom temperature unavailable",
            runbook_url:
              "https://homeassistant.tailnet-1a49.ts.net/history?entity_id=sensor.master_bathroom_temperature",
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
            description: `Home Assistant entity ${entity}, required by a Temporal home automation, has been unavailable or absent from metrics for 15 minutes.`,
            summary: `Home automation dependency unavailable: ${entity}`,
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
            description: `Pet-care entity ${entity} has been unavailable or absent from Home Assistant metrics for 15 minutes.`,
            summary: `Pet-care entity unavailable: ${entity}`,
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            `homeassistant_entity_available{entity="${entity}"} == 0 or absent(homeassistant_entity_available{entity="${entity}"})`,
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
        // General battery alert. The Roborock floor vacuums are excluded here —
        // they're governed by the charging-aware RoborockBatteryLowNotCharging
        // rule below (a docked unit routinely sits below 20% while recharging,
        // which the general rule would otherwise page on for 2h).
        createSensorAlert({
          name: "HomeAssistantBatteryLow",
          entity:
            'min by (entity) (homeassistant_sensor_battery_percent{entity!~"sensor[.](1st|2nd|3rd)_floor_battery",entity!~".*blue_pure.*filter.*"})',
          condition: "<",
          threshold: 20, // Lowered from 30 to reduce flapping - 20% is genuinely critical
          description: "Battery low: {{ $value }}% ({{ $labels.entity }}).",
          summary: "Home Assistant battery low",
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
            "Roborock {{ $labels.friendly_name }} reports a problem (stuck / robot error / dock error). Check the vacuum.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} vacuum problem",
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
            "Roborock {{ $labels.friendly_name }} dock dirty-water tank is full — empty it.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} dirty-water tank full",
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
            "Roborock {{ $labels.friendly_name }} dock clean-water tank is empty — refill it.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} clean-water tank empty",
          ),
          duration: "5m",
        }),
        createSensorAlert({
          name: "RoborockCleaningFluidLow",
          entity:
            'homeassistant_binary_sensor_state{entity=~"binary_sensor[.](1st|2nd|3rd)_floor_dock_cleaning_fluid"}',
          condition: "==",
          threshold: 1,
          description:
            "Roborock {{ $labels.friendly_name }} dock cleaning fluid is low — refill it.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} cleaning fluid low",
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
            "Roborock {{ $labels.friendly_name }} reports a water shortage.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} water shortage",
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
            "Roborock consumable {{ $labels.friendly_name }} has under 10h of life left ({{ $value }}h) — replace/clean it soon.",
          summary: escapePrometheusTemplate(
            "Roborock {{ $labels.friendly_name }} consumable due",
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
              "Roborock {{ $labels.friendly_name }} battery is low and not charging: {{ $value }}%.",
            ),
            summary: escapePrometheusTemplate(
              "Roborock {{ $labels.friendly_name }} battery low and not charging",
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
