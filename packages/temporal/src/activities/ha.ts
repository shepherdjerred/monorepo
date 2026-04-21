import {
  HomeAssistantRestClient,
  type EntityState,
} from "@shepherdjerred/home-assistant";

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
    return getClient().getState(entityId);
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
