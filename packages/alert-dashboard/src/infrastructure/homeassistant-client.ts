import { z } from "zod";

import type {
  HomeAssistantNotification,
  HomeAssistantPort,
} from "#application/ports";

const HUB_HOUSE_URL = "https://hub.tailnet-1a49.ts.net/house";

export type HomeAssistantFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type HomeAssistantClientOptions = {
  baseUrl: string;
  token: string;
  fetch?: HomeAssistantFetch;
};

export class HomeAssistantClient implements HomeAssistantPort {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: HomeAssistantFetch;

  constructor(options: HomeAssistantClientOptions) {
    this.#baseUrl = z.url().parse(options.baseUrl).replace(/\/$/u, "");
    this.#token = z.string().min(1).parse(options.token);
    this.#fetch = options.fetch ?? fetch;
  }

  async #postService(
    domain: string,
    service: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const response = await this.#fetch(
      `${this.#baseUrl}/api/services/${domain}/${service}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Home Assistant ${domain}.${service} returned ${String(response.status)}: ${body}`,
      );
    }
  }

  async send(notification: HomeAssistantNotification): Promise<void> {
    if (notification.action === "dismiss") {
      await this.#postService("persistent_notification", "dismiss", {
        notification_id: notification.notificationId,
      });
      return;
    }
    await this.#postService("persistent_notification", "create", {
      notification_id: notification.notificationId,
      title: notification.title,
      message: notification.message,
    });
    await this.#postService("notify", "mobile_app_jerreds_iphone", {
      title: notification.title,
      message: notification.message,
      data: {
        tag: notification.notificationId,
        url: HUB_HOUSE_URL,
      },
    });
  }
}
