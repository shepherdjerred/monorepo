import { afterEach, describe, expect, test } from "vitest";
import {
  CustomAuthRefreshInputSchema,
  CustomAuthResponseSchema,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import {
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  exchangeCustomActivityAuth,
  isAllowedCustomActivityOrigin,
  isCustomActivityTokenCandidate,
  refreshCustomActivityAuth,
  verifyCustomActivityTokenWithExpiry,
} from "#src/customs/activity-auth.ts";
import { handleCustomAuthRoutes } from "#src/customs/activity-auth-http.ts";

const GUILD_ID = "1337623164146155593";
const CHANNEL_ID = "1337623164146155594";
const INSTANCE_ID = "customs-instance";
const USER_ID = "1337623164146155595";
const START = new Date("2026-08-29T10:00:00.000Z");

afterEach(() => {
  resetFlagOverrides("custom_nights_enabled");
});

function discordResponse(value: unknown): Response {
  return Response.json(value);
}

async function mockDiscordFetch(
  input: string | URL | Request,
): Promise<Response> {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
  if (url.pathname === "/api/v10/oauth2/token") {
    return discordResponse({
      access_token: "discord-access",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "discord-refresh-rotated",
      scope: "identify rpc.activities.write",
    });
  }
  if (url.pathname === "/api/v10/oauth2/@me") {
    return discordResponse({
      application: { id: configuration.applicationId },
      user: { id: USER_ID },
      scopes: ["identify", "rpc.activities.write"],
    });
  }
  if (url.pathname.includes("/activity-instances/")) {
    return discordResponse({
      application_id: configuration.applicationId,
      instance_id: INSTANCE_ID,
      location: { guild_id: GUILD_ID, channel_id: CHANNEL_ID },
      users: [{ id: USER_ID }],
    });
  }
  return new Response("Not Found", { status: 404 });
}

function authOptions(now: Date) {
  return {
    fetcher: mockDiscordFetch,
    now: () => now,
    assertMember: () => Promise.resolve(),
  };
}

async function exchange(now: Date = START) {
  return exchangeCustomActivityAuth(
    {
      code: "discord-code",
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      instanceId: INSTANCE_ID,
    },
    authOptions(now),
  );
}

describe("custom Activity sessions", () => {
  test("bind a ten-minute token to the live Discord instance", async () => {
    const response = await exchange();
    const verified = await verifyCustomActivityTokenWithExpiry(
      response.activityToken,
      new Date(START.getTime() + 9 * 60 * 1000),
    );
    expect(verified?.claims).toEqual({
      sub: USER_ID,
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      instanceId: INSTANCE_ID,
      applicationId: configuration.applicationId,
      type: "customs_activity",
    });
    expect(
      await verifyCustomActivityTokenWithExpiry(
        response.activityToken,
        new Date(START.getTime() + 10 * 60 * 1000 + 1),
      ),
    ).toBeNull();
  });

  test("rotates credentials only inside the bounded refresh window", async () => {
    const response = await exchange();
    const refreshed = await refreshCustomActivityAuth(
      {
        activityToken: response.activityToken,
        discordRefreshToken: response.discordRefreshToken,
      },
      authOptions(new Date(START.getTime() + 11 * 60 * 1000)),
    );
    expect(refreshed.discordRefreshToken).toBe("discord-refresh-rotated");
    expect(refreshed.refreshUntil).toBe(response.refreshUntil);

    await expect(
      refreshCustomActivityAuth(
        {
          activityToken: response.activityToken,
          discordRefreshToken: response.discordRefreshToken,
        },
        authOptions(new Date(START.getTime() + 2 * 60 * 60 * 1000 + 1)),
      ),
    ).rejects.toThrow("invalid or expired");
  });

  test("rechecks the feature policy on refresh", async () => {
    const response = await exchange();
    clearFlagOverrides("custom_nights_enabled");
    await expect(
      refreshCustomActivityAuth(
        {
          activityToken: response.activityToken,
          discordRefreshToken: response.discordRefreshToken,
        },
        authOptions(new Date(START.getTime() + 60 * 1000)),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  test("rejects a Discord instance that does not match the launch context", async () => {
    await expect(
      exchangeCustomActivityAuth(
        {
          code: "discord-code",
          guildId: GUILD_ID,
          channelId: "1337623164146155999",
          instanceId: INSTANCE_ID,
        },
        authOptions(START),
      ),
    ).rejects.toThrow("instance context does not match");
  });
});

describe("custom Activity HTTP boundary", () => {
  const url = new URL("https://scout-for-lol.com/api/customs/auth/refresh");

  test("rejects malformed JSON without attempting authentication", async () => {
    const response = await handleCustomAuthRoutes(
      new Request(url.toString(), {
        method: "POST",
        headers: { Origin: "https://scout-for-lol.com" },
        body: "{",
      }),
      url,
    );
    expect(response?.status).toBe(400);
  });

  test("accepts Discord proxy origins and rejects lookalikes", () => {
    expect(isAllowedCustomActivityOrigin("https://123.discordsays.com")).toBe(
      true,
    );
    expect(
      isAllowedCustomActivityOrigin("https://discordsays.com.evil.test"),
    ).toBe(false);
  });
});

describe("custom Activity contracts", () => {
  test("discriminates JWTs from ordinary API tokens", () => {
    expect(isCustomActivityTokenCandidate("opaque-api-token")).toBe(false);
    expect(isCustomActivityTokenCandidate("header.payload.signature")).toBe(
      true,
    );
  });

  test("requires refresh credentials and exposes the bounded window", () => {
    expect(
      CustomAuthRefreshInputSchema.safeParse({
        activityToken: "token",
        discordAccessToken: "access",
      }).success,
    ).toBe(false);
    expect(
      CustomAuthResponseSchema.safeParse({
        discordAccessToken: "access",
        discordRefreshToken: "refresh",
        activityToken: "token",
        expiresAt: "2026-08-29T10:10:00.000Z",
        refreshUntil: "2026-08-29T12:00:00.000Z",
        contractHash: "hash",
      }).success,
    ).toBe(true);
  });
});
