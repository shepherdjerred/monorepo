import { describe, expect, it } from "vitest";
import { status } from "./e2e/harness/rwf-match.ts";
import { botsToAdd } from "./load/arming.ts";

function reply(bots: number, arriving: string): string {
  return [
    "Ready: true, phase: Countdown, features: enabled",
    `Match 1977f66c-6144-4607-acf0-0bf49568f09b, map training-yard, 1 humans, ${bots.toString()} bots, bot roster present`,
    `Watchers: 0, showcase: no, bots arriving: ${arriving}, playable maps: 1`,
  ].join("\n");
}

describe("RWF load reservations", () => {
  it("tops up around seven scheduled arrivals rather than adding twenty bots", async () => {
    const initial = await status({ command: async () => reply(0, "7") });
    expect(initial.arriving).toBe(7);
    const added = botsToAdd(initial, 20);
    expect(added).toBe(13);
    const toppedUp = await status({ command: async () => reply(added, "7") });
    expect(botsToAdd(toppedUp, 20)).toBe(0);
    const arrived = await status({ command: async () => reply(20, "0") });
    expect(arrived.bots).toBe(20);
    expect(botsToAdd(arrived, 20)).toBe(0);
  });

  it.each([
    { bots: 3, arriving: 4, target: 20, missing: 13 },
    { bots: 7, arriving: 0, target: 50, missing: 43 },
    { bots: 0, arriving: 7, target: 100, missing: 93 },
    { bots: 20, arriving: 1, target: 20, missing: 0 },
  ])("counts joined and reserved bots in $target load slots", (row) => {
    expect(botsToAdd(row, row.target)).toBe(row.missing);
  });

  it.each(["", "-1", "1.5", "unknown", "9007199254740992"])(
    "rejects malformed arrival count %s",
    async (arriving) => {
      await expect(
        status({ command: async () => reply(0, arriving) }),
      ).rejects.toThrow("no status");
    },
  );

  it("rejects status that omits the arrival reservation contract", async () => {
    await expect(
      status({
        command: async () => reply(0, "7").split("\n").slice(0, 2).join("\n"),
      }),
    ).rejects.toThrow("no status");
  });
});
