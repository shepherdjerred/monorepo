import { describe, expect, test } from "vitest";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import type { ToolTracker } from "#src/reports/ai/scoutql-tools.ts";
import { createChallengeExploreTools } from "./challenge-tools.ts";

const REQUESTER = DiscordAccountIdSchema.parse("160509172704739328");
const passthroughTracker: ToolTracker = async (_name, work) => await work();

describe("createChallengeExploreTools", () => {
  test("defines draft_challenge_contract with clear guidance for new challenges", () => {
    const tools = createChallengeExploreTools({
      requesterId: REQUESTER,
      track: passthroughTracker,
    });

    expect(tools.draft_challenge_contract.description).toContain(
      "New challenges are drafted from scratch without any source template",
    );
  });
});
