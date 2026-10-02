import { expect, test } from "vitest";
import { RawMatchSchema, RawParticipantSchema } from "@scout-for-lol/data";
import { participantLoadoutLakeRow } from "./loadout.ts";

async function participantWithMissingSecondaryStyle() {
  const fixture = new URL(
    "../league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json",
    import.meta.url,
  );
  const json: unknown = await Bun.file(fixture).json();
  const match = RawMatchSchema.parse(json);
  const participant = match.info.participants[0];
  if (participant === undefined) throw new Error("fixture participant missing");
  return {
    expectedTree: 8300,
    participant: RawParticipantSchema.parse({
      ...participant,
      perks: {
        statPerks: { offense: 5008, flex: 5008, defense: 5002 },
        styles: [
          {
            description: "primaryStyle",
            style: 8000,
            selections: [8005, 9111, 9104, 8014].map((perk) => ({
              perk,
              var1: 0,
              var2: 0,
              var3: 0,
            })),
          },
          {
            description: "subStyle",
            style: 0,
            selections: [8304, 8345].map((perk) => ({
              perk,
              var1: 0,
              var2: 0,
              var3: 0,
            })),
          },
        ],
      },
    }),
  };
}

test("real secondary selections recover Riot's zero secondaryStyleId", async () => {
  const { participant, expectedTree } =
    await participantWithMissingSecondaryStyle();
  const row = participantLoadoutLakeRow(participant);
  expect(row.secondary_rune_style_id).toBe(expectedTree);
  expect(row.secondary_rune_0_id).toBeGreaterThan(0);
});

test("Riot's all-zero rune sentinel remains an unavailable rune page", async () => {
  const { participant } = await participantWithMissingSecondaryStyle();
  const unavailable = RawParticipantSchema.parse({
    ...participant,
    perks: {
      statPerks: { offense: 0, flex: 0, defense: 0 },
      styles: participant.perks.styles.map((style) => ({
        ...style,
        style: 0,
        selections: style.selections.map((selection) => ({
          ...selection,
          perk: 0,
        })),
      })),
    },
  });
  expect(participantLoadoutLakeRow(unavailable)).toMatchObject({
    primary_rune_style_id: null,
    primary_rune_0_id: null,
    secondary_rune_style_id: null,
    secondary_rune_0_id: null,
    stat_perk_offense_id: null,
  });
});

test.each(["mixed", "unknown"] as const)(
  "a zero rune tree still rejects %s rune selections",
  async (kind) => {
    const { participant } = await participantWithMissingSecondaryStyle();
    const primaryRune = participant.perks.styles.find(
      (style) => style.description === "primaryStyle",
    )?.selections[0]?.perk;
    if (primaryRune === undefined)
      throw new Error("fixture primary rune missing");
    const invalid = RawParticipantSchema.parse({
      ...participant,
      perks: {
        ...participant.perks,
        styles: participant.perks.styles.map((style) =>
          style.description === "subStyle"
            ? {
                ...style,
                selections: style.selections.map((selection, index) =>
                  index === 0
                    ? {
                        ...selection,
                        perk: kind === "mixed" ? primaryRune : 999_999,
                      }
                    : selection,
                ),
              }
            : style,
        ),
      },
    });
    expect(() => participantLoadoutLakeRow(invalid)).toThrow(
      "inconsistent selections",
    );
  },
);
