import { describe, expect, test, vi } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import {
  handleMvpVoteButton,
  type VoteButtonInteraction,
} from "#src/mvp-votes/button-handler.ts";
import { MVP_VOTE_GUILD_ONLY } from "#src/mvp-votes/copy.ts";
import { formatVoteButtonCustomId } from "#src/mvp-votes/custom-id.ts";

describe("handleMvpVoteButton", () => {
  test("refuses a click that is not in a guild", async () => {
    const editReply = vi.fn(() => Promise.resolve(undefined));
    const interaction: VoteButtonInteraction = {
      customId: formatVoteButtonCustomId({
        category: "ally",
        matchId: MatchIdSchema.parse("NA1_5000000042"),
      }),
      guildId: null,
      user: { id: "160509172704739328" },
      deferReply: vi.fn(() => Promise.resolve(undefined)),
      editReply,
    };
    await handleMvpVoteButton(interaction);
    expect(editReply).toHaveBeenCalledWith({
      content: MVP_VOTE_GUILD_ONLY,
      components: [],
    });
  });
});
