import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { routeTurn } from "@shepherdjerred/birmel/agent-runtime/router.ts";
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
        return {
          route: expectedRoute,
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
        confidence: 0.5,
        rationale: "Ambiguous route",
      })),
    ).rejects.toThrow();
  });
});
