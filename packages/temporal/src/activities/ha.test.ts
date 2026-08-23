import { describe, expect, it } from "vitest";
import { ApplicationFailure } from "@temporalio/common";
import { HaApiError } from "@shepherdjerred/home-assistant";
import {
  HA_ENTITY_NOT_FOUND_ERROR_TYPE,
  HA_OPTIONAL_MEDIA_PLAYER_ERROR_TYPE,
} from "#shared/ha-errors.ts";
import { haActivities } from "./ha.ts";

describe("haActivities", () => {
  it("throws when HA_URL is not set", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    delete Bun.env["HA_URL"];
    delete Bun.env["HA_TOKEN"];

    try {
      await expect(haActivities.getEntityState("person.test")).rejects.toThrow(
        "HA_URL environment variable is required",
      );
    } finally {
      if (originalUrl !== undefined) {
        Bun.env["HA_URL"] = originalUrl;
      }
      if (originalToken !== undefined) {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });

  it("throws when HA_TOKEN is not set", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    Bun.env["HA_URL"] = "http://localhost:8123";
    delete Bun.env["HA_TOKEN"];

    try {
      await expect(haActivities.getEntityState("person.test")).rejects.toThrow(
        "HA_TOKEN environment variable is required",
      );
    } finally {
      if (originalUrl === undefined) {
        delete Bun.env["HA_URL"];
      } else {
        Bun.env["HA_URL"] = originalUrl;
      }
      if (originalToken !== undefined) {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });

  // A bare HaNotFoundError would reach the workflow as an untyped failure. It
  // must stay retryable: HA serves this endpoint before every integration has
  // registered its entities, so a startup/reload 404 is routinely transient.
  it("raises a typed retryable failure for an entity HA does not have", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    const originalFetch = globalThis.fetch;
    Bun.env["HA_URL"] = "http://localhost:8123";
    Bun.env["HA_TOKEN"] = "test-token";
    // Bun's fetch carries a `preconnect` member, so the stub has to be widened
    // with it to satisfy the global's type.
    globalThis.fetch = Object.assign(
      (): Promise<Response> =>
        Promise.resolve(new Response("Entity not found.", { status: 404 })),
      { preconnect: originalFetch.preconnect.bind(originalFetch) },
    );

    try {
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
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) {
        delete Bun.env["HA_URL"];
      } else {
        Bun.env["HA_URL"] = originalUrl;
      }
      if (originalToken === undefined) {
        delete Bun.env["HA_TOKEN"];
      } else {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });

  it("raises a typed retryable failure for an unavailable optional media player", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    const originalFetch = globalThis.fetch;
    Bun.env["HA_URL"] = "http://localhost:8123";
    Bun.env["HA_TOKEN"] = "test-token";
    globalThis.fetch = Object.assign(
      (): Promise<Response> =>
        Promise.resolve(
          new Response(
            "Sonos entity media_player.master_bathroom unavailable.",
            { status: 500 },
          ),
        ),
      { preconnect: originalFetch.preconnect.bind(originalFetch) },
    );

    try {
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
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) {
        delete Bun.env["HA_URL"];
      } else {
        Bun.env["HA_URL"] = originalUrl;
      }
      if (originalToken === undefined) {
        delete Bun.env["HA_TOKEN"];
      } else {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });

  it("keeps generic missing-entity media-player failures terminal", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    const originalFetch = globalThis.fetch;
    Bun.env["HA_URL"] = "http://localhost:8123";
    Bun.env["HA_TOKEN"] = "test-token";
    globalThis.fetch = Object.assign(
      (): Promise<Response> =>
        Promise.resolve(new Response("Entity not found.", { status: 404 })),
      { preconnect: originalFetch.preconnect.bind(originalFetch) },
    );

    try {
      await expect(
        haActivities.callOptionalMediaPlayerService("join", {
          entity_id: "media_player.bedroom",
          group_members: ["media_player.master_bathroom"],
        }),
      ).rejects.toBeInstanceOf(HaApiError);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) {
        delete Bun.env["HA_URL"];
      } else {
        Bun.env["HA_URL"] = originalUrl;
      }
      if (originalToken === undefined) {
        delete Bun.env["HA_TOKEN"];
      } else {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });

  it("keeps generic media-player API failures terminal", async () => {
    const originalUrl = Bun.env["HA_URL"];
    const originalToken = Bun.env["HA_TOKEN"];
    const originalFetch = globalThis.fetch;
    Bun.env["HA_URL"] = "http://localhost:8123";
    Bun.env["HA_TOKEN"] = "test-token";
    globalThis.fetch = Object.assign(
      (): Promise<Response> =>
        Promise.resolve(new Response("Internal Server Error", { status: 500 })),
      { preconnect: originalFetch.preconnect.bind(originalFetch) },
    );

    try {
      await expect(
        haActivities.callOptionalMediaPlayerService("join", {
          entity_id: "media_player.bedroom",
          group_members: ["media_player.master_bathroom"],
        }),
      ).rejects.toBeInstanceOf(HaApiError);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) {
        delete Bun.env["HA_URL"];
      } else {
        Bun.env["HA_URL"] = originalUrl;
      }
      if (originalToken === undefined) {
        delete Bun.env["HA_TOKEN"];
      } else {
        Bun.env["HA_TOKEN"] = originalToken;
      }
    }
  });
});
