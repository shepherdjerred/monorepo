import { describe, expect, mock, test } from "bun:test";
import {
  routeButton,
  type RoutableButtonInteraction,
} from "#src/discord/interactions.ts";
import { formatBucksCustomId } from "#src/betting/custom-id.ts";

/**
 * A stand-in for discord.js's ButtonInteraction, built the same way
 * `bet-button.integration.test.ts` builds one: the router's parameter type is
 * structural, so a plain object needs no cast and no mock framework.
 */
function fakeInteraction(customId: string, guildId: string | null = null) {
  const calls: string[] = [];
  const interaction: RoutableButtonInteraction = {
    customId,
    guildId,
    user: { id: "160509172704739328" },
    deferred: false,
    replied: false,
    deferUpdate: mock(() => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    }),
    deferReply: mock(() => {
      calls.push("deferReply");
      return Promise.resolve(undefined);
    }),
    editReply: mock(() => {
      calls.push("editReply");
      return Promise.resolve(undefined);
    }),
  };
  return { interaction, calls };
}

describe("routeButton", () => {
  test("leaves another feature's component entirely alone", async () => {
    const { interaction, calls } = fakeInteraction("someoneelse:1:thing");
    await routeButton(interaction);
    // Discord shows the clicker nothing for a component no handler claims, so
    // silence here is the correct answer rather than a missing acknowledgement.
    expect(calls).toEqual([]);
  });

  // `isBucksCustomId` is a prefix check, so the router has already claimed
  // these. Returning without acknowledging left the clicker looking at
  // Discord's red "This interaction failed" — and the router counted it as a
  // successful `bb` handling.
  test.each([
    ["bb:1:b:NA1_1:0:W", "too few segments — an older encoding"],
    ["bb:2:b:NA1_1:0:W:10", "a version this build does not speak"],
    ["bb:1:z:NA1_1:0:W:10", "an action outside the schema"],
    ["bb:1:b:NA1_1:99:W:10", "a roster index outside the frozen snapshot"],
    ["bb:", "the bare namespace"],
  ])("acknowledges a claimed but unparseable ID (%s)", async (customId) => {
    const { interaction, calls } = fakeInteraction(customId);
    await routeButton(interaction);
    expect(calls).toEqual(["deferUpdate"]);
  });

  test("a well-formed ID is not short-circuited as malformed", async () => {
    const { interaction, calls } = fakeInteraction(
      formatBucksCustomId({
        action: "b",
        matchId: "NA1_5000000042",
        subjectIndex: 0,
        side: "W",
        amount: 10,
      }),
    );
    await routeButton(interaction);
    // Reached the handler rather than being short-circuited: a null `guildId`
    // takes its no-server branch, which defers a real reply and answers — no
    // database, and no `deferUpdate`. What the handler decides for a click
    // inside a guild is `bet-button.integration.test.ts`'s subject.
    expect(calls).toEqual(["deferReply", "editReply"]);
  });
});
