import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { HaApiError } from "@shepherdjerred/home-assistant";
import {
  HA_ENTITY_NOT_FOUND_ERROR_TYPE,
  HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE,
} from "#shared/infra/ha-errors.ts";
import { haActivities } from "./ha.ts";

let originalUrl: string | undefined;
let originalToken: string | undefined;
let originalFetch: typeof globalThis.fetch;

function restoreEnvironmentValue(name: "HA_TOKEN" | "HA_URL", value?: string) {
  if (value === undefined) {
    if (name === "HA_TOKEN") {
      delete Bun.env["HA_TOKEN"];
    } else {
      delete Bun.env["HA_URL"];
    }
  } else {
    Bun.env[name] = value;
  }
}

function configureHaFetch(response: Response): void {
  Bun.env["HA_URL"] = "http://localhost:8123";
  Bun.env["HA_TOKEN"] = "test-token";
  // Bun's fetch carries a `preconnect` member, so the stub has to be widened
  // with it to satisfy the global's type.
  globalThis.fetch = Object.assign(
    (): Promise<Response> => Promise.resolve(response),
    { preconnect: originalFetch.preconnect.bind(originalFetch) },
  );
}

function configureHaServiceFetch(
  requests: { url: string; body: unknown }[],
): void {
  Bun.env["HA_URL"] = "http://localhost:8123";
  Bun.env["HA_TOKEN"] = "test-token";
  globalThis.fetch = Object.assign(
    (...args: Parameters<typeof fetch>): Promise<Response> => {
      const [input, init] = args;
      requests.push({
        url:
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return Promise.resolve(Response.json([]));
    },
    { preconnect: originalFetch.preconnect.bind(originalFetch) },
  );
}

describe("haActivities", () => {
  beforeEach(() => {
    originalUrl = Bun.env["HA_URL"];
    originalToken = Bun.env["HA_TOKEN"];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnvironmentValue("HA_URL", originalUrl);
    restoreEnvironmentValue("HA_TOKEN", originalToken);
  });

  it("throws when HA_URL is not set", async () => {
    delete Bun.env["HA_URL"];
    delete Bun.env["HA_TOKEN"];

    await expect(haActivities.getEntityState("person.test")).rejects.toThrow(
      "HA_URL environment variable is required",
    );
  });

  it("throws when HA_TOKEN is not set", async () => {
    Bun.env["HA_URL"] = "http://localhost:8123";
    delete Bun.env["HA_TOKEN"];

    await expect(haActivities.getEntityState("person.test")).rejects.toThrow(
      "HA_TOKEN environment variable is required",
    );
  });

  it("creates and dismisses tagged pet-care notifications and pushes to Jerred's iPhone", async () => {
    const requests: { url: string; body: unknown }[] = [];
    configureHaServiceFetch(requests);

    await haActivities.setPetCareNotification({
      entityId: "binary_sensor.litter_robot_problem",
      title: "Litter-Robot needs attention",
      message: "Litter-Robot reports error 4",
      active: true,
      sendPush: true,
    });
    await haActivities.setPetCareNotification({
      entityId: "binary_sensor.litter_robot_problem",
      title: "Litter-Robot needs attention",
      message: "Ready again",
      active: false,
      sendPush: false,
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:8123/api/services/persistent_notification/create",
        body: {
          notification_id: "binary_sensor.litter_robot_problem",
          title: "Litter-Robot needs attention",
          message: "Litter-Robot reports error 4",
        },
      },
      {
        url: "http://localhost:8123/api/services/notify/mobile_app_jerreds_iphone",
        body: {
          title: "Litter-Robot needs attention",
          message: "Litter-Robot reports error 4",
          data: { tag: "binary_sensor.litter_robot_problem" },
        },
      },
      {
        url: "http://localhost:8123/api/services/persistent_notification/dismiss",
        body: { notification_id: "binary_sensor.litter_robot_problem" },
      },
    ]);
  });

  // A bare HaNotFoundError would reach the workflow as an untyped failure. It
  // must stay retryable: HA serves this endpoint before every integration has
  // registered its entities, so a startup/reload 404 is routinely transient.
  it("raises a typed retryable failure for an entity HA does not have", async () => {
    configureHaFetch(new Response("Entity not found.", { status: 404 }));

    let failure: unknown;
    try {
      await haActivities.getEntityState("sensor.master_bathroom_temperature");
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a typed ApplicationFailure");
    }
    expect(failure.type).toBe(HA_ENTITY_NOT_FOUND_ERROR_TYPE);
    expect(failure.nonRetryable).toBe(false);
    expect(failure.message).toBe(
      "Home Assistant has no entity sensor.master_bathroom_temperature",
    );
  });

  it("raises a typed retryable failure for an unavailable optional media player", async () => {
    configureHaFetch(
      new Response("Sonos entity media_player.master_bathroom unavailable.", {
        status: 500,
      }),
    );

    let failure: unknown;
    try {
      await haActivities.callOptionalMediaPlayerService("join", {
        entity_id: "media_player.bedroom",
        group_members: ["media_player.master_bathroom"],
      });
    } catch (error: unknown) {
      failure = error;
    }
    if (!(failure instanceof ApplicationFailure)) {
      throw new TypeError("Expected a typed ApplicationFailure");
    }
    expect(failure.type).toBe(HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE);
    expect(failure.nonRetryable).toBe(false);
    expect(failure.message).toBe(
      "Home Assistant media_player.join is unavailable (500)",
    );
  });

  it.each([
    {
      name: "missing-entity",
      response: new Response("Entity not found.", { status: 404 }),
    },
    {
      name: "generic API",
      response: new Response("Internal Server Error", { status: 500 }),
    },
  ])("keeps $name media-player failures terminal", async ({ response }) => {
    configureHaFetch(response);

    await expect(
      haActivities.callOptionalMediaPlayerService("join", {
        entity_id: "media_player.bedroom",
        group_members: ["media_player.master_bathroom"],
      }),
    ).rejects.toBeInstanceOf(HaApiError);
  });
});
