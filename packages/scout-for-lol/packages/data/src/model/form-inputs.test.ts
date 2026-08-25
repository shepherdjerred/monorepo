import { describe, expect, test } from "vitest";
import {
  CompetitionDescriptionSchema,
  CompetitionMaxParticipantsSchema,
  CompetitionTitleSchema,
  FeedbackBodySchema,
  PlayerAliasSchema,
  ReportDescriptionSchema,
  ReportTitleSchema,
} from "#src/model/form-inputs.ts";

describe("shared form input constraints", () => {
  test("trims identity and title values", () => {
    expect(PlayerAliasSchema.parse("  Player One  ")).toBe("Player One");
    expect(ReportTitleSchema.parse("  Activity  ")).toBe("Activity");
    expect(CompetitionTitleSchema.parse("  Clash  ")).toBe("Clash");
  });

  test("enforces text length boundaries", () => {
    expect(FeedbackBodySchema.safeParse("x".repeat(4001)).success).toBe(false);
    expect(ReportDescriptionSchema.safeParse("x".repeat(501)).success).toBe(
      false,
    );
    expect(
      CompetitionDescriptionSchema.safeParse("x".repeat(501)).success,
    ).toBe(false);
  });

  test("enforces participant range and integer values", () => {
    expect(CompetitionMaxParticipantsSchema.safeParse(2).success).toBe(true);
    expect(CompetitionMaxParticipantsSchema.safeParse(1).success).toBe(false);
    expect(CompetitionMaxParticipantsSchema.safeParse(100).success).toBe(true);
    expect(CompetitionMaxParticipantsSchema.safeParse(101).success).toBe(false);
    expect(CompetitionMaxParticipantsSchema.safeParse(2.5).success).toBe(false);
  });
});
