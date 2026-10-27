import { formatDareCustomId } from "#src/dares/lifecycle/dare-custom-id.ts";
import {
  routeButton,
  type RoutableButtonInteraction,
} from "#src/discord/interactions.ts";
import { formatVoteButtonCustomId } from "#src/mvp-votes/custom-id.ts";
import { DiscordAccountIdSchema, RiotMatchIdSchema } from "@scout-for-lol/data";
import type { DiscordGuildId } from "@scout-for-lol/domain/identity/discord.ts";
import { describe, expect, test, vi } from "vitest";

const USER_ID = DiscordAccountIdSchema.parse("160509172704739328");

/**
 * A stand-in for discord.js's ButtonInteraction, built the same way
 * `bet-button.integration.test.ts` builds one: the router's parameter type is
 * structural, so a plain object needs no cast and no mock framework.
 */
function fakeInteraction(
  customId: string,
  guildId: DiscordGuildId | null = null,
) {
  const calls: string[] = [];
  const interaction: RoutableButtonInteraction = {
    customId,
    guildId,
    user: { id: USER_ID, username: "tester", avatar: null },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn(() => {
      calls.push("deferUpdate");
      return Promise.resolve(undefined);
    }),
    deferReply: vi.fn(() => {
      calls.push("deferReply");
      return Promise.resolve(undefined);
    }),
    editReply: vi.fn(() => {
      calls.push("editReply");
      return Promise.resolve(undefined);
    }),
    followUp: vi.fn(() => {
      calls.push("followUp");
      return Promise.resolve({ delete: () => Promise.resolve(undefined) });
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
    expect(calls).toEqual(["deferUpdate"]);
  });

  test("acknowledges malformed Dare IDs and routes valid ones", async () => {
    const malformed = fakeInteraction("dare:1:q:0:1:a:0");
    await routeButton(malformed.interaction);
    expect(malformed.calls).toEqual(["deferUpdate"]);

    const valid = fakeInteraction(
      formatDareCustomId({
        kind: "delete",
        dareId: 42,
        revision: 1,
      }),
    );
    await routeButton(valid.interaction);
    expect(valid.calls).toEqual(["deferReply", "editReply"]);
  });

  test("acknowledges a malformed Scout component with a private explanation", async () => {
    const { interaction, calls } = fakeInteraction("scout:1:publish:broken");
    await routeButton(interaction);
    expect(calls).toEqual(["deferUpdate", "followUp"]);
  });

  test("acknowledges malformed MVP vote IDs and routes valid ones", async () => {
    const malformed = fakeInteraction("vote:1:z:NA1_1");
    await routeButton(malformed.interaction);
    expect(malformed.calls).toEqual(["deferUpdate"]);

    const valid = fakeInteraction(
      formatVoteButtonCustomId({
        category: "ally",
        matchId: RiotMatchIdSchema.parse("NA1_5000000042"),
      }),
    );
    await routeButton(valid.interaction);
    expect(valid.calls).toEqual(["deferReply", "editReply"]);
  });
});
