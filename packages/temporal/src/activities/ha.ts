import { ApplicationFailure } from "@temporalio/common";
import {
  HaNotFoundError,
  HomeAssistantRestClient,
  type EntityState,
} from "@shepherdjerred/home-assistant";
import { HA_ENTITY_NOT_FOUND_ERROR_TYPE } from "#shared/ha-errors.ts";

// Activity signatures stay monomorphic (Temporal's proxyActivities rejects
// generic methods), so the runtime client is the loose default. Compile-time
// type safety lives in src/workflows/ha/util.ts, which wraps each activity
// with schema-parameterized signatures that forward through as strings.
let cachedClient: HomeAssistantRestClient | undefined;

function getClient(): HomeAssistantRestClient {
  if (cachedClient !== undefined) {
    return cachedClient;
  }
  const baseUrl = Bun.env["HA_URL"];
  const token = Bun.env["HA_TOKEN"];
  if (baseUrl === undefined || baseUrl === "") {
    throw new Error("HA_URL environment variable is required");
  }
  if (token === undefined || token === "") {
    throw new Error("HA_TOKEN environment variable is required");
  }
  cachedClient = new HomeAssistantRestClient({ baseUrl, token });
  return cachedClient;
}

export type HaActivities = typeof haActivities;

export const haActivities = {
  async getEntityState(entityId: string): Promise<EntityState> {
    try {
      return await getClient().getState(entityId);
    } catch (error: unknown) {
      // Retyped, not made terminal. A bare HaNotFoundError crosses the activity
      // boundary as an untyped failure, so a workflow cannot tell a missing
      // entity from any other error; the type is what makes that possible.
      // It stays retryable because HA answers this endpoint before every
      // integration has registered its entities, so a 404 during a restart or
      // integration reload is routinely transient. Only an entity still absent
      // after the caller's whole retry budget reaches the workflow.
      if (error instanceof HaNotFoundError) {
        throw ApplicationFailure.retryable(
          `Home Assistant has no entity ${entityId}`,
          HA_ENTITY_NOT_FOUND_ERROR_TYPE,
        );
      }
      throw error;
    }
  },

  async getStates(): Promise<EntityState[]> {
    return getClient().getStates();
  },

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await getClient().callService(domain, service, data);
    console.warn(`Called HA service: ${domain}.${service}`);
  },

  async sendNotification(title: string, message: string): Promise<void> {
    await getClient().callService("notify", "notify", { title, message });
    console.warn(`Sent notification: ${title}`);
  },

  async getEntitiesInDomain(domain: string): Promise<EntityState[]> {
    const prefix = `${domain}.`;
    const states = await getClient().getStates();
    return states.filter((state) => state.entity_id.startsWith(prefix));
  },
};
