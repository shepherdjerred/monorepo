import type { Client } from "@temporalio/client";
import {
  HomeAssistantEventClient,
  HomeAssistantRestClient,
} from "@shepherdjerred/home-assistant";
import { handleIosAction, handleStateChanged } from "./triggers.ts";
import { startGithubWebhook, type WebhookHandle } from "./github-webhook.ts";
import {
  startAgentTaskApi,
  type AgentTaskApiHandle,
} from "./agent-task-api.ts";
import {
  startXcodeCloudWebhook,
  type XcodeCloudWebhookHandle,
} from "./xcode-cloud-webhook.ts";

export type EventBridgeHandle = {
  close: () => Promise<void>;
};

export function startHttpServers(client: Client): EventBridgeHandle {
  // GitHub webhook server is optional — only start when the secret is set.
  // Local dev / smoke tests can run the worker without webhook ingest.
  let webhook: WebhookHandle | undefined;
  if ((Bun.env["GITHUB_WEBHOOK_SECRET"] ?? "") === "") {
    console.warn("GITHUB_WEBHOOK_SECRET not set; skipping PR webhook server");
  } else {
    webhook = startGithubWebhook(client);
  }

  const agentTaskApi: AgentTaskApiHandle = startAgentTaskApi(client);

  // Xcode Cloud webhook receiver is optional — only start when its token is
  // set. Translates iOS build-failure webhooks into Alertmanager alerts.
  let xcodeCloud: XcodeCloudWebhookHandle | undefined;
  if ((Bun.env["XCODE_CLOUD_WEBHOOK_TOKEN"] ?? "") === "") {
    console.warn(
      "XCODE_CLOUD_WEBHOOK_TOKEN not set; skipping Xcode Cloud webhook server",
    );
  } else {
    xcodeCloud = startXcodeCloudWebhook();
  }

  return {
    async close() {
      if (webhook !== undefined) {
        await webhook.close();
      }
      await agentTaskApi.close();
      if (xcodeCloud !== undefined) {
        await xcodeCloud.close();
      }
    },
  };
}

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
