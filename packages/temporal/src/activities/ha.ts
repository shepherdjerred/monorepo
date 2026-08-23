import { ApplicationFailure } from "@temporalio/common";
import { z } from "zod";
import {
  HaApiError,
  HaNotFoundError,
  HomeAssistantRestClient,
  type EntityState,
} from "@shepherdjerred/home-assistant";
import {
  HA_ENTITY_NOT_FOUND_ERROR_TYPE,
  HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE,
} from "#shared/ha-errors.ts";

// Activity signatures stay monomorphic (Temporal's proxyActivities rejects
// generic methods), so the runtime client is the loose default. Compile-time
// type safety lives in src/workflows/ha/util.ts, which wraps each activity
// with schema-parameterized signatures that forward through as strings.
let cachedClient: HomeAssistantRestClient | undefined;
const MediaPlayerEntityId = z.string().startsWith("media_player.");

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

function optionalMediaPlayerEntityIds(data: Record<string, unknown>): string[] {
  const groupMembers = data["group_members"];
  if (Array.isArray(groupMembers)) {
    return groupMembers.flatMap((value) => {
      const result = MediaPlayerEntityId.safeParse(value);
      return result.success ? [result.data] : [];
    });
  }

  const entityId = data["entity_id"];
  const result = MediaPlayerEntityId.safeParse(entityId);
  if (result.success) {
    return [result.data];
  }
  return [];
}

function isOptionalMediaPlayerUnavailable(
  error: HaApiError,
  data: Record<string, unknown>,
): boolean {
  if (error.status !== 404 && error.status < 500) {
    return false;
  }
  const text = `${error.message}\n${error.body}`;
  return (
    optionalMediaPlayerEntityIds(data).some((entityId) =>
      text.toLowerCase().includes(entityId.toLowerCase()),
    ) && /unavailable|not found|does not exist|offline/i.test(text)
  );
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

  async callOptionalMediaPlayerService(
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      await getClient().callService("media_player", service, data);
      console.warn(`Called HA service: media_player.${service}`);
    } catch (error: unknown) {
      // A missing media entity or a Sonos integration/device failure is a
      // known degraded condition for optional speakers. Keep the failure
      // retryable so transient HA reloads get the normal activity retry budget,
      // then expose it as a stable type for the workflow to handle.
      if (
        error instanceof HaApiError &&
        isOptionalMediaPlayerUnavailable(error, data)
      ) {
        throw ApplicationFailure.retryable(
          `Home Assistant media_player.${service} is unavailable (${String(error.status)})`,
          HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE,
        );
      }
      throw error;
    }
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
