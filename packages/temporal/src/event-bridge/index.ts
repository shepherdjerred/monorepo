import type { Client } from "@temporalio/client";
import {
  HomeAssistantEventClient,
  HomeAssistantRestClient,
} from "@shepherdjerred/home-assistant";
import { handleIosAction, handleStateChanged } from "./triggers.ts";

export type EventBridgeHandle = {
  close: () => Promise<void>;
};

export async function startEventBridge(
  client: Client,
): Promise<EventBridgeHandle> {
  const baseUrl = Bun.env["HA_URL"];
  const token = Bun.env["HA_TOKEN"];
  if (baseUrl === undefined || baseUrl === "") {
    throw new Error("HA_URL environment variable is required");
  }
  if (token === undefined || token === "") {
    throw new Error("HA_TOKEN environment variable is required");
  }

  const events = new HomeAssistantEventClient({ baseUrl, token });
  const rest = new HomeAssistantRestClient({ baseUrl, token });
  events.onConnectionChange((state, detail) => {
    if (state === "error") {
      const message =
        detail instanceof Error ? detail.message : JSON.stringify(detail);
      console.error(`HA event bridge error: ${message}`);
      return;
    }
    console.warn(`HA event bridge state: ${state}`);
  });

  await events.connect();
  await events.subscribeEvents("ios.action_fired", handleIosAction(client));
  await events.subscribeEvents(
    "state_changed",
    handleStateChanged(client, rest),
  );
  console.warn("HA event bridge subscriptions active");

  return {
    async close() {
      await events.close();
    },
  };
}
