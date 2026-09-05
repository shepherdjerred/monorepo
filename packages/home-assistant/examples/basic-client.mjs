import { HomeAssistantRestClient } from "@shepherdjerred/home-assistant";

const {
  HA_ENTITY_ID: entityId,
  HA_TOKEN: token,
  HA_URL: baseUrl,
} = process.env;

if (baseUrl === undefined || token === undefined || entityId === undefined) {
  throw new Error(
    "Set HA_URL, HA_TOKEN, and HA_ENTITY_ID before running this example.",
  );
}

const client = new HomeAssistantRestClient({ baseUrl, token });
const state = await client.getState(entityId);

console.log(`${state.entity_id}: ${state.state}`);
