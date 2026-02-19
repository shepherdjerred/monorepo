import type { PrometheusRuleSpecGroups } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { PrometheusRuleSpecGroupsRulesExpr } from "@shepherdjerred/homelab/cdk8s/generated/imports/monitoring.coreos.com";
import { createSensorAlert, createBinarySensorAlert } from "./shared.ts";

export function getHomeAssistantRuleGroups(): PrometheusRuleSpecGroups[] {
  return [
    // Litter Robot monitoring
    {
      name: "homeassistant-litter-robot",
      rules: [
        createSensorAlert({
          name: "LitterRobotLitterLow",
          entity: 'homeassistant_sensor_unit_percent{entity="sensor.litter_robot_4_litter_level"}',
          condition: "<",
          threshold: 90,
          description: "Litter Robot litter is low: {{ $value }}% ({{ $labels.entity }}).",
          summary: "Litter Robot litter low",
        }),
        createSensorAlert({
          name: "LitterRobotWasteHigh",
          entity: 'homeassistant_sensor_unit_percent{entity="sensor.litter_robot_4_waste_drawer"}',
          condition: ">",
          threshold: 70,
          description: "Litter Robot waste drawer is high: {{ $value }}% ({{ $labels.entity }}).",
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
          description: "Binary sensor {{ $labels.entity }} reports low state ({{ $value }}).",
          summary: "Eversweet water level low",
        }),
        createBinarySensorAlert({
          name: "GranaryFeederBatteryStatusBad",
          entity: "binary_sensor.granary_smart_camera_feeder_battery_status",
          description: "Binary sensor {{ $labels.entity }} reports low state ({{ $value }}).",
          summary: "Granary feeder battery status low",
        }),
        createBinarySensorAlert({
          name: "GranaryFeederFoodDispenserBad",
          entity: "binary_sensor.granary_smart_camera_feeder_food_dispenser",
          description: "Binary sensor {{ $labels.entity }} reports bad state ({{ $value }}).",
          summary: "Granary feeder food dispenser bad",
        }),
        createBinarySensorAlert({
          name: "GranaryFeederFoodStatusBad",
          entity: "binary_sensor.granary_smart_camera_feeder_food_status",
          description: "Binary sensor {{ $labels.entity }} reports low state ({{ $value }}).",
          summary: "Granary feeder low food",
        }),
        createSensorAlert({
          name: "GranaryFeederDesiccantRemainingDays",
          entity: 'homeassistant_sensor_duration_d{entity="sensor.granary_smart_camera_feeder_desiccant_remaining_days"}',
          condition: "<=",
          threshold: 0,
          description: "Granary feeder desiccant is overdue: {{ $value }} days remaining ({{ $labels.entity }}).",
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
        createBinarySensorAlert({
          name: "RoombaBinFull",
          entity: "binary_sensor.roomba_bin_full",
          description: "Binary sensor {{ $labels.entity }} reports bad state ({{ $value }}).",
          summary: "Roomba bin full",
          duration: "15m",
        }),
        {
          alert: "RoombaNotRunningRecently",
          annotations: {
            description:
              'Roomba has not run any missions in the last 48 hours ({{ "{{" }} $value {{ "}}" }} missions).',
            summary: "Roomba not running recently",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'increase(homeassistant_sensor_unit_missions{entity="sensor.roomba_total_missions"}[48h]) == 0',
          ),
          for: "1h",
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
            description:
              '{{ "{{" }} $value {{ "}}" }} Home Assistant entities are unavailable or unknown:\n{{ "{{" }} with query "homeassistant_entity_available == 0" {{ "}}" }}{{ "{{" }} range sortByLabel "friendly_name" . {{ "}}" }}\n- {{ "{{" }} .Labels.friendly_name {{ "}}" }} ({{ "{{" }} .Labels.entity {{ "}}" }}){{ "{{" }} end {{ "}}" }}{{ "{{" }} end {{ "}}" }}',
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
        // General battery alert for non-Roomba devices
        createSensorAlert({
          name: "HomeAssistantBatteryLow",
          entity: 'min by (entity) (homeassistant_sensor_battery_percent{entity!="sensor.roomba_battery",entity!~".*blue_pure.*filter.*"})',
          condition: "<",
          threshold: 30, // Lowered from 50 to reduce noise - 30% is still actionable
          description: "Battery low: {{ $value }}% ({{ $labels.entity }}).",
          summary: "Home Assistant battery low",
          duration: "1h",
        }),
        // Specific Roomba battery alert that only fires when battery is low AND decreasing (not charging)
        {
          alert: "RoombaBatteryLowNotCharging",
          annotations: {
            description:
              'Roomba battery is low and not charging: {{ "{{" }} $value {{ "}}" }}% ({{ "{{" }} $labels.entity {{ "}}" }}).',
            summary: "Roomba battery low and not charging",
          },
          expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
            'homeassistant_sensor_battery_percent{entity="sensor.roomba_battery"} < 20 and increase(homeassistant_sensor_battery_percent{entity="sensor.roomba_battery"}[30m]) <= 0',
          ),
          for: "10m",
          labels: { severity: "warning" },
        },
      ],
    },
  ];
}
