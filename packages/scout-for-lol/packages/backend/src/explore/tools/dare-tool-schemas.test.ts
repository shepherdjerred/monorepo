import { LeaguePuuidSchema } from "@scout-for-lol/domain/identity/league-account.ts";
import { DiscordAccountIdSchema } from "@scout-for-lol/domain/identity/discord.ts";
import { describe, expect, test } from "vitest";
import { prepareDareDraft } from "#src/betting/dares/lifecycle/dare-draft.ts";
import { DareDefinitionToolInputSchema } from "#src/explore/tools/dare-tool-schemas.ts";

/** A contract whose lane spelling Riot never emits. */
const INVALID_LANE_DEFINITION = {
  originalText: "Play mid lane",
  displayTitle: "Virmel plays mid",
  statusPhrases: {},
  targetKeys: ["T1"],
  queryText:
    "SELECT COUNT(*) >= 1 AS achieved FROM T1 p WHERE p.team_position = 'MID'",
  plainLanguage: "Virmel plays at least one game in the middle lane.",
  deadlineSpec: { kind: "relative", days: 7 },
  openingStake: 5,
};

describe("Dare tool input schema", () => {
  // The AI SDK validates tool input against this schema before the executor
  // runs. If the value-domain check lived here, the SDK would reject the call
  // itself and the model would see a generic invalid-tool-input error instead
  // of the issue text naming MIDDLE — so the domain check has to be reachable,
  // not pre-empted.
  test("accepts an out-of-domain contract so the executor can answer it", () => {
    expect(
      DareDefinitionToolInputSchema.safeParse(INVALID_LANE_DEFINITION).success,
    ).toBe(true);
  });

  test("requires English list copy at the tool boundary", () => {
    expect(
      DareDefinitionToolInputSchema.safeParse({
        ...INVALID_LANE_DEFINITION,
        displayTitle: undefined,
        statusPhrases: undefined,
      }).success,
    ).toBe(false);
  });

  test("the executor returns the actionable domain issue", async () => {
    const parsed = DareDefinitionToolInputSchema.parse(INVALID_LANE_DEFINITION);
    const prepared = await prepareDareDraft({
      originalText: parsed.originalText,
      queryText: parsed.queryText,
      plainLanguage: parsed.plainLanguage,
      targets: [
        {
          key: "T1",
          discordId: DiscordAccountIdSchema.parse("100000000000000001"),
          playerId: 1,
          alias: "Virmel",
          accounts: [
            {
              puuid: LeaguePuuidSchema.parse(
                "frozen-puuid000000000000000000000000000000000000000000000000000000000000000000",
              ),
              trackingStartedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
      ],
      deadlineSpec: parsed.deadlineSpec,
      openingStake: parsed.openingStake,
    });
    expect(prepared.kind).toBe("invalid");
    expect(
      prepared.kind === "invalid" ? prepared.issues.join(" ") : "",
    ).toContain("MIDDLE");
  });
});
