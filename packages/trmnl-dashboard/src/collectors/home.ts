import type { AppConfig, ConfiguredEntity } from "../config.ts";
import { HomeStatusClient } from "../clients/home-assistant.ts";
import { worstStatus } from "../status.ts";
import { formatDisplayTime } from "../time.ts";
import type { EntitySummary, HomePayload } from "../types.ts";

export type HomeCollectorClient = {
  getConfiguredEntities: (
    entities: readonly ConfiguredEntity[],
  ) => Promise<EntitySummary[]>;
  getProblemEntities: (
    batteryThreshold: number,
    unavailableIgnoredDomains: readonly string[],
  ) => Promise<{
    unavailable: EntitySummary[];
    unavailableCount: number;
    lowBatteries: EntitySummary[];
    lowBatteryCount: number;
  }>;
};

export async function collectHomePayload(
  config: AppConfig,
  client: HomeCollectorClient = new HomeStatusClient(
    config.homeAssistant.url,
    config.homeAssistant.token,
  ),
): Promise<HomePayload> {
  const errors: string[] = [];
  let presence: EntitySummary[] = [];
  let security: EntitySummary[] = [];
  let climate: EntitySummary[] = [];
  let unavailable: EntitySummary[] = [];
  let lowBatteries: EntitySummary[] = [];
  let unavailableCount = 0;
  let lowBatteryCount = 0;

  try {
    [presence, security, climate] = await Promise.all([
      client.getConfiguredEntities(config.homeAssistant.presence),
      client.getConfiguredEntities(config.homeAssistant.security),
      client.getConfiguredEntities(config.homeAssistant.climate),
    ]);
  } catch (error) {
    errors.push(errorMessage("configured entities", error));
  }

  try {
    const problems = await client.getProblemEntities(
      config.homeAssistant.batteryThreshold,
      config.homeAssistant.unavailableIgnoredDomains,
    );
    unavailable = problems.unavailable;
    unavailableCount = problems.unavailableCount;
    lowBatteries = problems.lowBatteries;
    lowBatteryCount = problems.lowBatteryCount;
  } catch (error) {
    errors.push(errorMessage("problem entities", error));
  }

  const status = worstStatus([
    ...presence.map((entity) => entity.status),
    ...security.map((entity) =>
      isSecurityBad(entity) ? "warning" : entity.status,
    ),
    ...climate.map((entity) => entity.status),
    ...unavailable.map((entity) => entity.status),
    ...lowBatteries.map((entity) => entity.status),
    errors.length > 0 ? "unknown" : "ok",
  ]);

  const summaryParts = [
    `${presence.filter((entity) => entity.state === "home").length.toString()} home`,
    `${unavailableCount.toString()} unavailable`,
    `${lowBatteryCount.toString()} low battery`,
  ];
  const generatedAt = new Date();

  return {
    screen: "home",
    generated_at: generatedAt.toISOString(),
    generated_time: formatDisplayTime(generatedAt, config.displayTimeZone),
    status,
    summary: summaryParts.join(" · "),
    counts: {
      unavailable: unavailableCount,
      low_battery: lowBatteryCount,
    },
    presence,
    security,
    climate,
    unavailable,
    low_batteries: lowBatteries,
    errors,
  };
}

function isSecurityBad(entity: EntitySummary): boolean {
  return ["open", "unlocked", "on", "detected"].includes(entity.state);
}

function errorMessage(area: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Home Assistant ${area}: ${message}`;
}
