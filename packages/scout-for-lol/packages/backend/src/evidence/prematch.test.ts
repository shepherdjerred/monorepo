import { beforeEach, expect, test, vi } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import { rawCurrentGameInfoFixture } from "#src/testing/raw-capture-fixtures.ts";

const io = vi.hoisted(() => ({ riot: vi.fn(), client: vi.fn() }));
vi.mock("#src/league/api/spectator.ts", () => ({ getActiveGame: io.riot }));
vi.mock("#src/scout-client/prematch-evidence.ts", () => ({
  readClientPrematchEvidence: io.client,
}));
const { resolvePrematch } = await import("./prematch.ts");
const puuid = LeaguePuuidSchema.parse("p".repeat(78));
beforeEach(() => {
  io.riot.mockReset();
  io.client.mockReset();
});

test("an optional client outage cannot erase Riot's prematch", async () => {
  const game = rawCurrentGameInfoFixture();
  io.riot.mockResolvedValue({ kind: "in-game", game });
  io.client.mockRejectedValue(
    Object.assign(new Error("Client evidence database unavailable"), {
      code: "P1001",
    }),
  );
  expect(await resolvePrematch(puuid, "AMERICA_NORTH")).toEqual({
    kind: "in-game",
    game,
  });
});

test("corrupt client evidence fails loudly even when Riot is available", async () => {
  io.riot.mockResolvedValue({
    kind: "in-game",
    game: rawCurrentGameInfoFixture(),
  });
  io.client.mockRejectedValue(new Error("Corrupt client contract"));
  await expect(resolvePrematch(puuid, "AMERICA_NORTH")).rejects.toThrow(
    "Corrupt client contract",
  );
});

test("a Riot 404 with an unavailable client remains retryable", async () => {
  io.riot.mockResolvedValue({ kind: "not-in-game" });
  io.client.mockRejectedValue(
    Object.assign(new Error("Client source unavailable"), { code: "P1001" }),
  );
  expect(await resolvePrematch(puuid, "AMERICA_NORTH")).toMatchObject({
    kind: "unavailable",
    upstream: false,
  });
  io.client.mockResolvedValue({ game: null, identities: { gameId: 1 } });
  expect(await resolvePrematch(puuid, "AMERICA_NORTH")).toMatchObject({
    kind: "unavailable",
  });
  io.client.mockResolvedValue(null);
  expect(await resolvePrematch(puuid, "AMERICA_NORTH")).toEqual({
    kind: "not-in-game",
  });
});
