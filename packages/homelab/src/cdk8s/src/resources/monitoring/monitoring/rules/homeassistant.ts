import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import {
  createSensorAlert,
  createBinarySensorAlert,
  escapePrometheusTemplate,
} from "./shared.ts";

const ignoredUnavailableEntityDomains = [
  "group",
  "automation",
  "scene",
  "script",
  "button",
  "event",
  "number",
  "select",
  "text",
  "update",
];

const ignoredUnavailableEntities = [
  "sensor.unavailable_entities_count",
  "conversation.home_assistant",
  "stt.home_assistant_cloud",
  "tts.home_assistant_cloud",
];

const ignoredUnavailableEntityDomainPattern = String.raw`^(${ignoredUnavailableEntityDomains.join("|")})[.].*`;

const unavailableEntitiesAnnotationQuery = `homeassistant_entity_available{entity!~"${ignoredUnavailableEntityDomainPattern}",${ignoredUnavailableEntities.map((entity) => `entity!="${entity}"`).join(",")}} == 0`;

const escapedUnavailableEntitiesAnnotationQuery =
  unavailableEntitiesAnnotationQuery.replaceAll('"', String.raw`\"`);

export function getHomeAssistantRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Litter Robot monitoring
    {
      name: "homeassistant-litter-robot",
      rules: [
        createSensorAlert({
          name: "LitterRobotLitterLow",
          entity:
            'homeassistant_sensor_unit_percent{entity="sensor.litter_robot_4_litter_level"}',
          condition: "<",
          threshold: 90,
          description:
            "Litter Robot litter is low: {{ $value }}% ({{ $labels.entity }}).",
          summary: "Litter Robot litter low",
        }),
        createSensorAlert({
          name: "LitterRobotWasteHigh",
          entity:
            'homeassistant_sensor_unit_percent{entity="sensor.litter_robot_4_waste_drawer"}',
          condition: ">",
          threshold: 70,
          description:
            "Litter Robot waste drawer is high: {{ $value }}% ({{ $labels.entity }}).",
          summary: "Litter Robot waste high",
          duration: "1h", // Increased from default 10m to reduce flapping from sensor variance
        }),
        {
          alert: "LitterRobotNotCyclingRecently",
          annotations: {
            description:
              'Litter Robot has not cycled in the last 12 hours ({{ "{{" }} $value {{ "}}" }} cycles).',
            summary: "Litter Robot not cycling",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(homeassistant_sensor_unit_cycles{entity="sensor.litter_robot_4_total_cycles"}[12h]) == 0', // Extended from 6h to account for overnight
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },

    // Binary sensor monitoring
    {
      name: "homeassistant-binary-sensors",
      rules: [
        createBinarySensorAlert({
          name: "EversweetWaterLevelBad",
          entity: "binary_sensor.eversweet_3_pro_water_level",
          description:
            "Binary sensor {{ $labels.entity }} reports low state ({{ $value }}).",
          summary: "Eversweet water level low",
        }),
        createBinarySensorAlert({
          name: "GranaryFeederBatteryStatusBad",
          entity: "binary_sensor.granary_smart_camera_feeder_battery_status",
          description:
            "Binary sensor {{ $labels.entity }} reports low state ({{ $value }}).",
          summary: "Granary feeder battery status low",
        }),
        createBinarySensorAlert({
          name: "GranaryFeederFoodDispenserBad",
          entity: "binary_sensor.granary_smart_camera_feeder_food_dispenser",
          description:
            "Binary sensor {{ $labels.entity }} reports bad state ({{ $value }}).",
          summary: "Granary feeder food dispenser bad",
        }),
        createBinarySensorAlert({
          name: "GranaryFeederFoodStatusBad",
          entity: "binary_sensor.granary_smart_camera_feeder_food_status",
          description:
            "Binary sensor {{ $labels.entity }} reports low state ({{ $value }}).",
          summary: "Granary feeder low food",
        }),
        createSensorAlert({
          name: "GranaryFeederDesiccantRemainingDays",
          entity:
            'homeassistant_sensor_duration_d{entity="sensor.granary_smart_camera_feeder_desiccant_remaining_days"}',
          condition: "<=",
          threshold: 0,
          description:
            "Granary feeder desiccant is overdue: {{ $value }} days remaining ({{ $labels.entity }}).",
          summary: "Granary feeder desiccant remaining days",
          duration: "24h", // Alert once per day instead of every 10m to reduce noise
        }),
        {
          alert: "GranaryFeederNotDispensing",
          annotations: {
            description:
              'Granary feeder has not dispensed food in over 14 hours. Time since last feed: {{ "{{" }} $value | humanizeDuration {{ "}}" }}.',
            summary: "Granary feeder not dispensing",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'time() - homeassistant_sensor_timestamp_seconds{entity="sensor.granary_smart_camera_feeder_last_feed_time"} > 50400',
          ),
          for: "30m",
          labels: { severity: "warning" },
        },
      ],
    },

    // Entity availability monitoring
    {
      name: "homeassistant-availability",
      rules: [
        {
          alert: "HomeAssistantEntitiesUnavailable",
          annotations: {
            description: `{{ "{{" }} $value {{ "}}" }} Home Assistant entities are unavailable or unknown:\n{{ "{{" }} with query "${escapedUnavailableEntitiesAnnotationQuery}" {{ "}}" }}{{ "{{" }} range sortByLabel "friendly_name" . {{ "}}" }}\n- {{ "{{" }} .Labels.friendly_name {{ "}}" }} ({{ "{{" }} .Labels.entity {{ "}}" }}){{ "{{" }} end {{ "}}" }}{{ "{{" }} end {{ "}}" }}`,
            summary: "Home Assistant entities unavailable",
            runbook_url:
              "https://homeassistant.tailnet-1a49.ts.net/history?entity_id=sensor.unavailable_entities_count",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'homeassistant_sensor_unit_entities{entity="sensor.unavailable_entities_count"} > 5',
          ),
          for: "15m",
          labels: { severity: "warning" },
        },
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
    // via friendly_name. severity:warning → PagerDuty (Alertmanager severity
    // route). Metric names + the enum→binary bridges (*_vacuum_problem template
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
          summary: "Roborock vacuum problem",
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
          summary: "Roborock dirty-water tank full",
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
          summary: "Roborock clean-water tank empty",
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
          summary: "Roborock cleaning fluid low",
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
          summary: "Roborock water shortage",
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
          summary: "Roborock consumable due",
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
            summary: "Roborock battery low and not charging",
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
