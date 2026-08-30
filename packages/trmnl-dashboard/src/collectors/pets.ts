import type { EntityState } from "@shepherdjerred/home-assistant";
import type { AppConfig } from "../config.ts";
import { AlertsClient, type AlertSummaryItem } from "../clients/alerts.ts";
import {
  PetCareHomeAssistantClient,
  type LitterRobotSnapshot,
} from "../clients/pet-care.ts";
import { isUnavailableState, worstStatus, type Status } from "../status.ts";
import { formatDisplayTime, startOfDisplayDay } from "../time.ts";
import type { PetCarePayload, PetProblem } from "../types.ts";

const FOUNTAIN = "dockstream_2_smart_fountain";
const FEEDER = "granary_smart_camera_feeder";
const PET_ALERT_PATTERN = /^(?:PetCare|PetLibro|LitterRobot|Roborock)/;

const VACUUMS = [
  { id: "1st-floor", label: "1st Floor", prefix: "1st_floor" },
  { id: "2nd-floor", label: "2nd Floor", prefix: "2nd_floor" },
  { id: "3rd-floor", label: "3rd Floor", prefix: "3rd_floor" },
] as const;

const FEEDERS = [
  { id: "living-room", label: "Living Room", suffix: "" },
  { id: "guest-room", label: "Guest Room", suffix: "_2" },
] as const;

export type PetCareClients = {
  homeAssistant: Pick<
    PetCareHomeAssistantClient,
    "getStates" | "getLitterRobot" | "getHistory"
  >;
  alerts: Pick<AlertsClient, "listOpen">;
};

export type PetCareCollection = {
  payload: PetCarePayload;
  metrics: PetCareMetricSnapshot;
};

export type PetCareMetricSnapshot = {
  sourceUp: { homeAssistant: boolean; whisker: boolean; alerts: boolean };
  litterRobot: LitterRobotSnapshot | null;
  litterHaMismatch: boolean | null;
};

export function createPetCareClients(config: AppConfig): PetCareClients {
  return {
    homeAssistant: new PetCareHomeAssistantClient(
      config.homeAssistant.url,
      config.homeAssistant.token,
    ),
    alerts: new AlertsClient(config.homelab.alertDashboardUrl),
  };
}

export async function collectPetCare(
  config: AppConfig,
  clients = createPetCareClients(config),
  now = new Date(),
): Promise<PetCareCollection> {
  const errors: string[] = [];
  const [statesResult, litterResult, alertsResult] = await Promise.allSettled([
    clients.homeAssistant.getStates(),
    clients.homeAssistant.getLitterRobot(now),
    clients.alerts.listOpen(100),
  ]);
  const states = resultOrNull(statesResult, "Home Assistant states", errors);
  const litterRobot = resultOrNull(litterResult, "Whisker diagnostics", errors);
  const openAlerts =
    resultOrNull(alertsResult, "Alertmanager alerts", errors) ?? [];
  const petAlerts = openAlerts.filter((alert) =>
    PET_ALERT_PATTERN.test(alert.alertname),
  );
  const cyclesToday = await collectLitterCycles({
    client: clients.homeAssistant,
    states,
    robot: litterRobot,
    start: startOfDisplayDay(now, config.displayTimeZone),
    errors,
  });
  const fountain = buildFountain(states, petAlerts);
  const feeders = FEEDERS.map((feeder) =>
    buildFeeder(states, petAlerts, feeder),
  );
  const litter = buildLitterRobot(litterRobot, petAlerts, cyclesToday);
  const vacuums = VACUUMS.map((vacuum) =>
    buildVacuum(states, petAlerts, vacuum),
  );
  const problems = toProblems(petAlerts);
  const generatedAt = now.toISOString();
  const activity = {
    drinking_ounces: fountain.drinking_ounces_today,
    drinking_visits: fountain.drinking_visits_today,
    feedings: sumOptional(feeders.map((feeder) => feeder.feedings_today)),
    food_grams: sumOptional(feeders.map((feeder) => feeder.food_grams_today)),
    litter_cycles: cyclesToday,
  };
  const sourceStatus: Status = errors.length > 0 ? "unknown" : "ok";
  const payload: PetCarePayload = {
    screen: "pets",
    generated_at: generatedAt,
    generated_time: formatDisplayTime(now, config.displayTimeZone),
    status: worstStatus([
      fountain.status,
      ...feeders.map((feeder) => feeder.status),
      litter?.status ?? "unknown",
      ...vacuums.map((vacuum) => vacuum.status),
      sourceStatus,
    ]),
    summary:
      problems.length === 0
        ? "Pet systems healthy"
        : `${problems.length.toString()} active pet-care problem${problems.length === 1 ? "" : "s"}`,
    problems,
    fountain,
    feeders,
    litter_robot: litter,
    vacuums,
    activity,
    errors,
  };

  return {
    payload,
    metrics: {
      sourceUp: {
        homeAssistant: statesResult.status === "fulfilled",
        whisker: litterResult.status === "fulfilled",
        alerts: alertsResult.status === "fulfilled",
      },
      litterRobot,
      litterHaMismatch:
        states == null || litterRobot == null
          ? null
          : litterValuesMismatch(states, litterRobot),
    },
  };
}

function buildFountain(
  states: EntityState[] | null,
  alerts: AlertSummaryItem[],
): PetCarePayload["fountain"] {
  const fields = {
    water_percent: numberState(states, `sensor.${FOUNTAIN}_remaining_water_2`),
    water_ounces: numberState(states, `sensor.${FOUNTAIN}_remaining_water`),
    cleaning_days: numberState(
      states,
      `sensor.${FOUNTAIN}_remaining_cleaning_days`,
    ),
    filter_days: numberState(states, `sensor.${FOUNTAIN}_remaining_filter_day`),
    dispensing: booleanState(
      states,
      `binary_sensor.${FOUNTAIN}_water_dispensing_state`,
    ),
    dispensing_mode: stringState(
      states,
      `select.${FOUNTAIN}_water_dispensing_mode`,
    ),
    wifi: booleanState(states, `binary_sensor.${FOUNTAIN}_wi_fi`),
    drinking_ounces_today: numberState(
      states,
      `sensor.${FOUNTAIN}_today_s_water_consumption`,
    ),
    drinking_visits_today: numberState(
      states,
      `sensor.${FOUNTAIN}_today_s_total_drinking_times`,
    ),
  };
  return {
    status: componentStatus(
      alerts,
      (alert) =>
        alert.alertname.startsWith("PetLibroFountain") ||
        isAvailabilityAlertFor(alert, "dockstream_2_smart_fountain"),
    ),
    ...fields,
  };
}

function buildFeeder(
  states: EntityState[] | null,
  alerts: AlertSummaryItem[],
  feeder: (typeof FEEDERS)[number],
): PetCarePayload["feeders"][number] {
  const alertToken = feeder.id === "living-room" ? "LivingRoom" : "GuestRoom";
  const feederEntities = [
    `binary_sensor.${FEEDER}_battery_status${feeder.suffix}`,
    `binary_sensor.${FEEDER}_food_dispenser${feeder.suffix}`,
    `binary_sensor.${FEEDER}_food_status${feeder.suffix}`,
    `binary_sensor.${FEEDER}_wi_fi${feeder.suffix}`,
    `sensor.${FEEDER}_desiccant_remaining_days${feeder.suffix}`,
    `sensor.${FEEDER}_last_feed_time${feeder.suffix}`,
  ];
  return {
    id: feeder.id,
    label: feeder.label,
    status: componentStatus(
      alerts,
      (alert) =>
        alert.alertname.includes(`Feeder${alertToken}`) ||
        feederEntities.some((entity) => isAvailabilityAlertFor(alert, entity)),
    ),
    food_low: booleanState(
      states,
      `binary_sensor.${FEEDER}_food_status${feeder.suffix}`,
    ),
    dispenser_problem: booleanState(
      states,
      `binary_sensor.${FEEDER}_food_dispenser${feeder.suffix}`,
    ),
    battery_problem: booleanState(
      states,
      `binary_sensor.${FEEDER}_battery_status${feeder.suffix}`,
    ),
    wifi: booleanState(states, `binary_sensor.${FEEDER}_wi_fi${feeder.suffix}`),
    desiccant_days: numberState(
      states,
      `sensor.${FEEDER}_desiccant_remaining_days${feeder.suffix}`,
    ),
    last_feed_at: stringState(
      states,
      `sensor.${FEEDER}_last_feed_time${feeder.suffix}`,
    ),
    feedings_today: numberState(
      states,
      `sensor.${FEEDER}_today_s_feeding_times${feeder.suffix}`,
    ),
    food_grams_today: numberState(
      states,
      `sensor.${FEEDER}_today_s_feeding_quantity_weight${feeder.suffix}`,
    ),
  };
}

function buildLitterRobot(
  robot: LitterRobotSnapshot | null,
  alerts: AlertSummaryItem[],
  cyclesToday: number | null,
): PetCarePayload["litter_robot"] {
  if (robot == null) {
    return null;
  }
  return {
    status: componentStatus(alerts, (alert) =>
      alert.alertname.startsWith("LitterRobot"),
    ),
    name: "Storage",
    online: robot.online,
    ready: robot.ready,
    litter_percent: robot.litterPercent,
    waste_percent: robot.wastePercent,
    hopper_status: robot.hopperLabel,
    hopper_level_raw: robot.hopperLevelRaw,
    hopper_installed: robot.hopperInstalled,
    hopper_enabled: robot.hopperEnabled,
    last_seen_at: robot.lastSeenAt,
    filter_due_at: robot.filterDueAt,
    cycles_today: cyclesToday,
  };
}

function buildVacuum(
  states: EntityState[] | null,
  alerts: AlertSummaryItem[],
  vacuum: (typeof VACUUMS)[number],
): PetCarePayload["vacuums"][number] {
  const hours = ["main_brush", "side_brush", "filter", "dock_strainer"]
    .map((part) =>
      numberState(states, `sensor.${vacuum.prefix}_${part}_time_left`),
    )
    .filter((value) => value != null);
  return {
    id: vacuum.id,
    label: vacuum.label,
    status: componentStatus(
      alerts,
      (alert) =>
        (alert.alertname.startsWith("Roborock") &&
          alert.summary.toLowerCase().includes(vacuum.label.toLowerCase())) ||
        isAvailabilityAlertFor(alert, vacuum.prefix),
    ),
    state: stringState(states, `vacuum.${vacuum.prefix}`),
    battery_percent: numberState(states, `sensor.${vacuum.prefix}_battery`),
    last_clean_at: stringState(
      states,
      `sensor.${vacuum.prefix}_last_clean_end`,
    ),
    consumable_hours: hours.length === 0 ? null : Math.min(...hours),
    clean_water_empty: booleanState(
      states,
      `binary_sensor.${vacuum.prefix}_dock_clean_water_box`,
    ),
    dirty_water_full: booleanState(
      states,
      `binary_sensor.${vacuum.prefix}_dock_dirty_water_box`,
    ),
    cleaning_fluid_low: booleanState(
      states,
      `binary_sensor.${vacuum.prefix}_dock_cleaning_fluid`,
    ),
    water_shortage: booleanState(
      states,
      `binary_sensor.${vacuum.prefix}_water_shortage`,
    ),
    dust_bag: null,
  };
}

async function collectLitterCycles(options: {
  client: PetCareClients["homeAssistant"];
  states: EntityState[] | null;
  robot: LitterRobotSnapshot | null;
  start: Date;
  errors: string[];
}): Promise<number | null> {
  const { client, states, robot, start, errors } = options;
  if (states == null || robot == null) {
    return null;
  }
  const entity = states.find((state) =>
    state.entity_id.endsWith("_scoops_saved"),
  );
  if (entity === undefined) {
    errors.push("Home Assistant litter activity entity is missing");
    return null;
  }
  try {
    const history = await client.getHistory(entity.entity_id, start);
    const first = history[0]?.map((state) => Number(state.state))[0];
    return first == null || !Number.isFinite(first)
      ? null
      : Math.max(0, robot.totalCycles - first);
  } catch (error) {
    errors.push(errorMessage("Home Assistant litter activity", error));
    return null;
  }
}

function litterValuesMismatch(
  states: EntityState[],
  robot: LitterRobotSnapshot,
): boolean {
  const litter = states.find((state) =>
    state.entity_id.endsWith("_litter_level"),
  );
  const waste = states.find((state) =>
    state.entity_id.endsWith("_waste_drawer"),
  );
  const status = states.find((state) =>
    state.entity_id.endsWith("_status_code"),
  );
  if (litter === undefined || waste === undefined || status === undefined) {
    return true;
  }
  return (
    Math.abs(Number(litter.state) - robot.litterPercent) > 1 ||
    Math.abs(Number(waste.state) - robot.wastePercent) > 1 ||
    (robot.ready && !["rdy", "ready"].includes(status.state.toLowerCase()))
  );
}

function toProblems(alerts: AlertSummaryItem[]): PetProblem[] {
  return alerts.map((alert) => ({
    severity:
      alert.severity.toLowerCase() === "critical" ? "critical" : "warning",
    alert: alert.alertname,
    summary: alert.summary,
  }));
}

function componentStatus(
  alerts: AlertSummaryItem[],
  matches: (alert: AlertSummaryItem) => boolean,
): Status {
  const matching = alerts.filter((alert) => matches(alert));
  if (matching.some((alert) => alert.severity.toLowerCase() === "critical")) {
    return "error";
  }
  return matching.length > 0 ? "warning" : "ok";
}

function isAvailabilityAlertFor(
  alert: AlertSummaryItem,
  entityToken: string,
): boolean {
  return (
    alert.alertname === "PetCareEntityUnavailable" &&
    alert.summary.includes(entityToken)
  );
}

function stateValue(
  states: EntityState[] | null,
  entityId: string,
): string | null {
  const state = states?.find((candidate) => candidate.entity_id === entityId);
  return state === undefined || isUnavailableState(state.state)
    ? null
    : state.state;
}

function stringState(
  states: EntityState[] | null,
  entityId: string,
): string | null {
  return stateValue(states, entityId);
}

function numberState(
  states: EntityState[] | null,
  entityId: string,
): number | null {
  const state = stateValue(states, entityId);
  if (state === null) {
    return null;
  }
  const value = Number(state);
  return Number.isFinite(value) ? value : null;
}

function booleanState(
  states: EntityState[] | null,
  entityId: string,
): boolean | null {
  const value = stateValue(states, entityId);
  return value == null ? null : value === "on";
}

function sumOptional(values: (number | null)[]): number | null {
  return values.some((value) => value == null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function resultOrNull<T>(
  result: PromiseSettledResult<T>,
  label: string,
  errors: string[],
): T | null {
  if (result.status === "fulfilled") {
    return result.value;
  }
  errors.push(errorMessage(label, result.reason));
  return null;
}

function errorMessage(area: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${area}: ${message}`;
}
