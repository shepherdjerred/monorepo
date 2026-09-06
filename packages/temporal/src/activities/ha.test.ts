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
