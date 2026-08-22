import { describe, expect, test } from "vitest";
import {
  CustomAuthRefreshInputSchema,
  CustomAuthResponseSchema,
} from "@scout-for-lol/data";
import {
  handleCustomAuthRoutes,
  isCustomActivityTokenCandidate,
} from "#src/customs/activity-auth.ts";

const refreshUrl = new URL("https://customs.example/api/customs/auth/refresh");

async function authResponse(body: string): Promise<Response> {
  const response = await handleCustomAuthRoutes(
    new Request(refreshUrl.toString(), { method: "POST", body }),
    refreshUrl,
    { "Access-Control-Allow-Origin": "https://customs.example" },
  );
  if (response === null) throw new Error("Custom auth route was not handled");
  return response;
}

describe("custom Activity auth HTTP boundary", () => {
  test("returns 400 for malformed JSON", async () => {
    const response = await authResponse("{");
    expect(response.status).toBe(400);
  });

  test("returns 400 for a request outside the auth contract", async () => {
    const response = await authResponse(
      JSON.stringify({ activityToken: "token" }),
    );
    expect(response.status).toBe(400);
  });

  test("reserves 401 for a rejected authentication attempt", async () => {
    const response = await authResponse(
      JSON.stringify({
        activityToken: "not-a-valid-token",
        discordRefreshToken: "discord-refresh-token",
      }),
    );
    expect(response.status).toBe(401);
  });
});

describe("custom Activity bearer discrimination", () => {
  test("does not JWT-verify ordinary opaque API tokens", () => {
    expect(isCustomActivityTokenCandidate("opaque-api-token")).toBe(false);
  });

  test("recognizes a three-segment JWT candidate", () => {
    expect(isCustomActivityTokenCandidate("header.payload.signature")).toBe(
      true,
    );
  });
});

describe("custom Activity Discord token rotation contract", () => {
  test("returns both rotating Discord credentials in memory", () => {
    const response = CustomAuthResponseSchema.parse({
      discordAccessToken: "discord-access-token",
      discordRefreshToken: "discord-refresh-token",
      activityToken: "activity-token",
      expiresAt: "2026-08-16T10:00:00.000Z",
      contractHash: "contract-hash",
    });
    expect(response.discordRefreshToken).toBe("discord-refresh-token");
  });

  test("requires the refresh credential instead of an expiring access token", () => {
    expect(
      CustomAuthRefreshInputSchema.safeParse({
        activityToken: "activity-token",
        discordAccessToken: "discord-access-token",
      }).success,
    ).toBe(false);
    expect(
      CustomAuthRefreshInputSchema.safeParse({
        activityToken: "activity-token",
        discordRefreshToken: "discord-refresh-token",
      }).success,
    ).toBe(true);
  });
});
