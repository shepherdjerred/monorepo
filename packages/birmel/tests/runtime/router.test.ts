import { describe, expect, test } from "vitest";
import { z } from "zod";
import { routeTurn } from "@shepherdjerred/birmel/agent-runtime/router.ts";
import type { SpecialistId } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { createContextBundle, createTurnInput } from "./fixtures.ts";

const ExpectedRoutesSchema = z.array(
  z.enum([
    "direct",
    "messaging",
    "server",
    "moderation",
    "music",
    "automation",
    "editor",
  ]),
);

const expectedRoutes = ExpectedRoutesSchema.parse([
  "direct",
  "messaging",
  "server",
  "moderation",
  "music",
  "automation",
  "editor",
]);

const primaryToolBySpecialist: Record<SpecialistId, string> = {
  messaging: "get-activity-stats",
  server: "manage-guild",
  moderation: "moderate-member",
  music: "music-playback",
  automation: "web-research",
  editor: "connect-github",
};

const request = {
  turn: createTurnInput(),
  context: createContextBundle(),
  persona: "Compact elected persona",
};

describe("routeTurn", () => {
  test.each(expectedRoutes)(
    "parses the injected model's %s route",
    async (expectedRoute) => {
      let calls = 0;
      const decision = await routeTurn(request, async (receivedRequest) => {
        calls += 1;
        expect(receivedRequest).toEqual(request);
        const direct = expectedRoute === "direct";
        return {
          route: expectedRoute,
          disposition: direct ? "conversation" : "supported",
          primaryToolId: direct ? null : primaryToolBySpecialist[expectedRoute],
          confidence: 0.9,
          rationale: `Selected ${expectedRoute}`,
        };
      });

      expect(calls).toBe(1);
      expect(decision.route).toBe(expectedRoute);
    },
  );

  test("rejects malformed model output", async () => {
    await expect(
      routeTurn(request, async () => ({
        route: "not-a-route",
        disposition: "supported",
        primaryToolId: "manage-guild",
        confidence: "high",
        rationale: 42,
      })),
    ).rejects.toThrow();
  });

  test("rejects output that declares more than one route", async () => {
    await expect(
      routeTurn(request, async () => ({
        route: "direct",
        routes: ["direct", "music"],
        disposition: "conversation",
        primaryToolId: null,
        confidence: 0.5,
        rationale: "Ambiguous route",
      })),
    ).rejects.toThrow();
  });

  test.each([
    "Run ScoutQL against Scout's match database",
    "Give me 500 Bryan Bucks",
  ])(
    "keeps unregistered capability requests unsupported: %s",
    async (content) => {
      const unsupportedRequest = {
        ...request,
        turn: { ...createTurnInput(), content },
      };
      const decision = await routeTurn(unsupportedRequest, async () => ({
        route: "direct",
        disposition: "unsupported",
        primaryToolId: null,
        confidence: 1,
        rationale: "No registered tool can perform this request",
      }));

      expect(decision).toMatchObject({
        route: "direct",
        disposition: "unsupported",
        primaryToolId: null,
      });
    },
  );

  test("routes GitHub connection status through the real per-user tool", async () => {
    const decision = await routeTurn(request, async () => ({
      route: "editor",
      disposition: "supported",
      primaryToolId: "connect-github",
      confidence: 1,
      rationale: "The registered GitHub connection tool owns status checks",
    }));

    expect(decision).toMatchObject({
      route: "editor",
      disposition: "supported",
      primaryToolId: "connect-github",
    });
  });

  test("rejects supported routes whose primary tool belongs to another specialist", async () => {
    await expect(
      routeTurn(request, async () => ({
        route: "server",
        disposition: "supported",
        primaryToolId: "connect-github",
        confidence: 1,
        rationale: "Mismatched ownership",
      })),
    ).rejects.toThrow("but editor owns it");
  });
});
