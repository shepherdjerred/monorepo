import { describe, expect, it } from "vitest";

import { HomeAssistantClient } from "#infrastructure/homeassistant-client";

type RecordedCall = {
  url: string;
  method: string | undefined;
  authorization: string | null;
  contentType: string | null;
  hasAbortSignal: boolean;
  body: unknown;
};

describe("HomeAssistantClient", () => {
  it("creates a persistent notification and pushes to iPhone on notify", async () => {
    const calls: RecordedCall[] = [];
    const client = new HomeAssistantClient({
      baseUrl: "http://homeassistant.home.svc:8123/",
      token: "ha-secret-token",
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url:
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          method: init?.method,
          authorization: headers.get("authorization"),
          contentType: headers.get("content-type"),
          hasAbortSignal: init?.signal instanceof AbortSignal,
          body:
            typeof init?.body === "string"
              ? (JSON.parse(init.body) as unknown)
              : null,
        });
        return Promise.resolve(new Response("[]", { status: 200 }));
      },
    });

    await client.send({
      action: "notify",
      notificationId: "hub-house-fp-roborock",
      title: "[House] RoborockConsumableDue",
      message: "Downstairs Roborock main brush needs replacement",
    });

    expect(calls).toEqual([
      {
        url: "http://homeassistant.home.svc:8123/api/services/persistent_notification/create",
        method: "POST",
        authorization: "Bearer ha-secret-token",
        contentType: "application/json",
        hasAbortSignal: true,
        body: {
          notification_id: "hub-house-fp-roborock",
          title: "[House] RoborockConsumableDue",
          message: "Downstairs Roborock main brush needs replacement",
        },
      },
      {
        url: "http://homeassistant.home.svc:8123/api/services/notify/mobile_app_jerreds_iphone",
        method: "POST",
        authorization: "Bearer ha-secret-token",
        contentType: "application/json",
        hasAbortSignal: true,
        body: {
          title: "[House] RoborockConsumableDue",
          message: "Downstairs Roborock main brush needs replacement",
          data: {
            tag: "hub-house-fp-roborock",
            url: "https://hub.tailnet-1a49.ts.net/house",
          },
        },
      },
    ]);
  });

  it("dismisses only the persistent notification on dismiss", async () => {
    const calls: RecordedCall[] = [];
    const client = new HomeAssistantClient({
      baseUrl: "http://homeassistant.home.svc:8123",
      token: "ha-secret-token",
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url:
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url,
          method: init?.method,
          authorization: headers.get("authorization"),
          contentType: headers.get("content-type"),
          hasAbortSignal: init?.signal instanceof AbortSignal,
          body:
            typeof init?.body === "string"
              ? (JSON.parse(init.body) as unknown)
              : null,
        });
        return Promise.resolve(new Response("[]", { status: 200 }));
      },
    });

    await client.send({
      action: "dismiss",
      notificationId: "hub-house-fp-roborock",
    });

    expect(calls).toEqual([
      {
        url: "http://homeassistant.home.svc:8123/api/services/persistent_notification/dismiss",
        method: "POST",
        authorization: "Bearer ha-secret-token",
        contentType: "application/json",
        hasAbortSignal: true,
        body: {
          notification_id: "hub-house-fp-roborock",
        },
      },
    ]);
  });

  it("throws when Home Assistant returns a non-OK status", async () => {
    const client = new HomeAssistantClient({
      baseUrl: "http://homeassistant.home.svc:8123",
      token: "ha-secret-token",
      fetch: () =>
        Promise.resolve(new Response("Service unavailable", { status: 503 })),
    });

    await expect(
      client.send({
        action: "dismiss",
        notificationId: "hub-house-fp-roborock",
      }),
    ).rejects.toThrow(
      "Home Assistant persistent_notification.dismiss returned 503",
    );
  });
});
