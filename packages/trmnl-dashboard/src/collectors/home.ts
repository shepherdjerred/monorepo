import type { AppConfig, ConfiguredEntity } from "../config.ts";
import { HomeStatusClient } from "../clients/home-assistant.ts";
import { worstStatus } from "../status.ts";
import type { EntitySummary, HomePayload } from "../types.ts";

export type HomeCollectorClient = {
  getConfiguredEntities: (
    entities: readonly ConfiguredEntity[],
  ) => Promise<EntitySummary[]>;
  getProblemEntities: (batteryThreshold: number) => Promise<{
    unavailable: EntitySummary[];
    lowBatteries: EntitySummary[];
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
    );
    unavailable = problems.unavailable;
    lowBatteries = problems.lowBatteries;
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
    `${unavailable.length.toString()} unavailable`,
    `${lowBatteries.length.toString()} low battery`,
  ];

  return {
    screen: "home",
    generated_at: new Date().toISOString(),
    status,
    summary: summaryParts.join(" · "),
    counts: {
      unavailable: unavailable.length,
      low_battery: lowBatteries.length,
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
