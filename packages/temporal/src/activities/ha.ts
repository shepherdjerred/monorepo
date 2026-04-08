import { z } from "zod/v4";

const EntityState = z.object({
  state: z.string(),
  entity_id: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.string(),
  last_updated: z.string(),
});

type EntityState = z.infer<typeof EntityState>;

function getHaConfig(): { url: string; token: string } {
  const url = Bun.env["HA_URL"];
  const token = Bun.env["HA_TOKEN"];

  if (url === undefined || url === "") {
    throw new Error("HA_URL environment variable is required");
  }
  if (token === undefined || token === "") {
    throw new Error("HA_TOKEN environment variable is required");
  }

  return { url, token };
}

function haHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export type HaActivities = typeof haActivities;

export const haActivities = {
  async getEntityState(entityId: string): Promise<EntityState> {
    const { url, token } = getHaConfig();
    const response = await fetch(`${url}/api/states/${entityId}`, {
      headers: haHeaders(token),
    });

    if (!response.ok) {
      throw new Error(
        `HA API error getting ${entityId}: ${String(response.status)} ${response.statusText}`,
      );
    }

    const json: unknown = await response.json();
    return EntityState.parse(json);
  },

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const { url, token } = getHaConfig();
    const response = await fetch(`${url}/api/services/${domain}/${service}`, {
      method: "POST",
      headers: haHeaders(token),
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(
        `HA API error calling ${domain}.${service}: ${String(response.status)} ${response.statusText}`,
      );
    }

    console.warn(`Called HA service: ${domain}.${service}`);
  },

  async sendNotification(title: string, message: string): Promise<void> {
    const { url, token } = getHaConfig();
    const response = await fetch(`${url}/api/services/notify/notify`, {
      method: "POST",
      headers: haHeaders(token),
      body: JSON.stringify({ title, message }),
    });

    if (!response.ok) {
      throw new Error(
        `HA notification failed: ${String(response.status)} ${response.statusText}`,
      );
    }

    console.warn(`Sent notification: ${title}`);
  },
};
