import { describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { bbCommand } from "#src/discord/commands/bb/bb-definition.ts";
import { isPublicBbSubcommand } from "#src/discord/commands/bb/bb.ts";
import { replyBbDare } from "#src/discord/commands/bb/bb-dare.ts";
import type { BbCommandInteraction } from "#src/discord/commands/bb/bb-interaction.ts";
import { bbInteractionAckMocks } from "#src/testing/bb-interaction-mocks.ts";

const SERVER = DiscordGuildIdSchema.parse("1337623164146155593");
const CHALLENGER = DiscordAccountIdSchema.parse("160509172704739328");
const TARGET = DiscordAccountIdSchema.parse("160509172704739329");
const CHANNEL = "1337623164146155594";
const EXPLORE_REFUSAL = "Scout Explore is not enabled in this server.";

function fakeInteraction(input?: {
  amount?: number;
  channelId?: string | null;
}): BbCommandInteraction {
  return {
    id: "bb-dare-test",
    guildId: SERVER,
    channelId: input?.channelId === undefined ? CHANNEL : input.channelId,
    user: { id: CHALLENGER },
    options: {
      getSubcommand: () => "dare",
      getString: () => "I bet Virmel can't win 7 games on Warwick",
      getInteger: () => input?.amount ?? 10,
      getUser: () => ({ id: TARGET, bot: false }),
    },
    ...bbInteractionAckMocks(true),
    followUp: vi.fn(() => Promise.resolve(undefined)),
  };
}

/**
 * Explore stands in for authoring here: refusing the guild is the first thing
 * the Explore flow does, so reaching that refusal proves the command handed
 * the request on, and never starting a turn keeps the test off the model.
 */
function exploreRefused() {
  return vi.fn(() => false);
}

describe("/bb dare", () => {
  test("registers a bounded free-text dare and whole-BB amount", () => {
    const dare = bbCommand
      .toJSON()
      .options?.find((option) => option.name === "dare");
    if (dare === undefined || !("options" in dare)) {
      throw new Error("/bb dare should be a subcommand with options");
    }
    expect(dare.options).toEqual([
      expect.objectContaining({
        name: "dare",
        required: true,
        type: 3,
        max_length: 400,
      }),
      expect.objectContaining({
        name: "amount",
        required: true,
        type: 4,
        min_value: 1,
        max_value: 2_147_483_647,
      }),
    ]);
    expect(isPublicBbSubcommand("dare")).toBe(false);
  });

  test("refuses when the Dares flag is off, before any authoring", async () => {
    const interaction = fakeInteraction();
    const isExploreGuildAllowed = exploreRefused();
    const isDaresPolicyEnabled = vi.fn(() => Promise.resolve(false));
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled,
      dareExplore: { isExploreGuildAllowed },
    });
    expect(isDaresPolicyEnabled).toHaveBeenCalledWith("bucks_dares_enabled", {
      server: SERVER,
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "🚫 Bryan Bucks dares aren't enabled in this server.",
    });
    expect(isExploreGuildAllowed).not.toHaveBeenCalled();
  });

  test("answers the friendlier insufficient error before authoring", async () => {
    const interaction = fakeInteraction({ amount: 10 });
    const isExploreGuildAllowed = exploreRefused();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.resolve(3),
      dareExplore: { isExploreGuildAllowed },
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "💸 You have **3 BB** but need **10 BB**.",
    });
    expect(isExploreGuildAllowed).not.toHaveBeenCalled();
  });

  test("a broken balance read never blocks the dare", async () => {
    const interaction = fakeInteraction();
    const isExploreGuildAllowed = exploreRefused();
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.reject(new Error("database unavailable")),
      dareExplore: { isExploreGuildAllowed },
    });
    expect(isExploreGuildAllowed).toHaveBeenCalledWith(SERVER);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: EXPLORE_REFUSAL,
    });
  });

  test("needs a server channel to post the eventual callout in", async () => {
    const interaction = fakeInteraction({ channelId: null });
    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.resolve(100),
      dareExplore: { isExploreGuildAllowed: exploreRefused() },
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: "🏠 Run `/bb dare` in a server channel.",
    });
  });
});

describe("/bb dare Explore access", () => {
  test("refuses before creating a turn in an ineligible guild", async () => {
    const interaction = fakeInteraction({ amount: 20 });
    const runTurn = vi.fn();

    await replyBbDare(interaction, SERVER, CHALLENGER, {
      isDaresPolicyEnabled: () => Promise.resolve(true),
      loadDareBalance: () => Promise.resolve(100),
      dareExplore: { isExploreGuildAllowed: () => false, runTurn },
    });

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: EXPLORE_REFUSAL,
    });
    expect(runTurn).not.toHaveBeenCalled();
  });
});
