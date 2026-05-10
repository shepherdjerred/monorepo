import {
  HomeAssistantRestClient,
  type EntityState,
} from "@shepherdjerred/home-assistant";
import type { ConfiguredEntity } from "../config.ts";
import { isUnavailableState } from "../status.ts";
import type { EntitySummary } from "../types.ts";

export class HomeStatusClient {
  private readonly client: HomeAssistantRestClient;

  constructor(baseUrl: string, token: string) {
    this.client = new HomeAssistantRestClient({ baseUrl, token });
  }

  async getConfiguredEntities(
    entities: readonly ConfiguredEntity[],
  ): Promise<EntitySummary[]> {
    const states = await Promise.all(
      entities.map(async (entity) => {
        const state = await this.client.getState(entity.entityId);
        return toEntitySummary(entity, state);
      }),
    );
    return states;
  }

  async getProblemEntities(batteryThreshold: number): Promise<{
    unavailable: EntitySummary[];
    lowBatteries: EntitySummary[];
  }> {
    const states = await this.client.getStates();
    return {
      unavailable: states
        .filter((state) => isUnavailableState(state.state))
        .map((state) => toEntitySummary(undefined, state))
        .toSorted((a, b) => a.label.localeCompare(b.label))
        .slice(0, 12),
      lowBatteries: states
        .flatMap((state) => {
          const summary = batterySummary(state, batteryThreshold);
          return summary == null ? [] : [summary];
        })
        .toSorted((a, b) => Number(a.state) - Number(b.state))
        .slice(0, 12),
    };
  }
}

function toEntitySummary(
  configured: ConfiguredEntity | undefined,
  state: EntityState,
): EntitySummary {
  const label = configured?.label ?? friendlyName(state);
  const unavailable = isUnavailableState(state.state);
  return {
    entity_id: state.entity_id,
    label,
    state: state.state,
    status: unavailable ? "warning" : "ok",
  };
}

function batterySummary(
  state: EntityState,
  threshold: number,
): EntitySummary | null {
  if (!state.entity_id.startsWith("sensor.")) {
    return null;
  }
  const deviceClass = state.attributes["device_class"];
  if (deviceClass !== "battery") {
    return null;
  }
  const value = Number(state.state);
  if (!Number.isFinite(value) || value > threshold) {
    return null;
  }
  return {
    entity_id: state.entity_id,
    label: friendlyName(state),
    state: String(value),
    status: value <= 10 ? "error" : "warning",
    detail: `${value.toString()}%`,
  };
}

function friendlyName(state: EntityState): string {
  const name = state.attributes["friendly_name"];
  return typeof name === "string" && name.length > 0 ? name : state.entity_id;
}
