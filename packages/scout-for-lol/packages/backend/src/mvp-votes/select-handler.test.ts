import { describe, expect, test, vi } from "vitest";
import type { ModalBuilder } from "discord.js";
import { MatchIdSchema } from "@scout-for-lol/data";
import {
  handleMvpVoteSelect,
  type VoteSelectInteraction,
} from "#src/mvp-votes/select-handler.ts";
import { MVP_VOTE_GUILD_ONLY } from "#src/mvp-votes/copy.ts";
import {
  formatVoteModalCustomId,
  formatVoteSelectCustomId,
} from "#src/mvp-votes/custom-id.ts";

describe("handleMvpVoteSelect", () => {
  test("refuses a pick that is not in a guild", async () => {
    const reply = vi.fn(() => Promise.resolve(undefined));
    const showModal = vi.fn(() => Promise.resolve(undefined));
    const interaction: VoteSelectInteraction = {
      customId: formatVoteSelectCustomId({
        category: "ally",
        matchId: MatchIdSchema.parse("NA1_5000000042"),
      }),
      guildId: null,
      user: { id: "160509172704739328" },
      values: ["3"],
      deferred: false,
      replied: false,
      showModal,
      reply,
    };
    await handleMvpVoteSelect(interaction);
    expect(showModal).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith({
      content: MVP_VOTE_GUILD_ONLY,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  });

  test("shows the reason modal before any persistence", async () => {
    const matchId = MatchIdSchema.parse("NA1_5000000042");
    const reply = vi.fn(() => Promise.resolve(undefined));
    let shown: ModalBuilder | undefined;
    const showModal = vi.fn((modal: ModalBuilder) => {
      shown = modal;
      return Promise.resolve(undefined);
    });
    const interaction: VoteSelectInteraction = {
      customId: formatVoteSelectCustomId({
        category: "enemy",
        matchId,
      }),
      guildId: "1337623164146155593",
      user: { id: "160509172704739328" },
      values: ["7"],
      deferred: false,
      replied: false,
      showModal,
      reply,
    };
    await handleMvpVoteSelect(interaction);
    expect(reply).not.toHaveBeenCalled();
    expect(shown?.toJSON().custom_id).toBe(
      formatVoteModalCustomId({
        category: "enemy",
        matchId,
        nomineeIndex: 7,
      }),
    );
  });
});
