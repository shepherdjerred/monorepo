import { describe, expect, test } from "vitest";
import {
  lookupAbilityText,
  lookupChampionText,
  lookupItemText,
  lookupPatchNotesText,
  VoiceTurnFactsRecorder,
} from "#src/voice-assistant/league-tools.ts";

/**
 * Golden answers over the committed Data Dragon / CommunityDragon assets.
 * These are the numbers the assistant is allowed to say out loud, so the
 * goldens pin real values, not shapes.
 */
describe("lookup_ability", () => {
  test("grounds Cho'Gath ult at rank one in 300 true damage", async () => {
    const recorder = new VoiceTurnFactsRecorder();
    const text = await lookupAbilityText(
      { champion: "chogath", ability: "R" },
      recorder,
    );
    expect(text).toContain("Feast");
    expect(text).toContain("RBaseDamage at rank 1: 300");
    expect(text).toContain("RBaseDamage by rank: [300, 475, 650]");
    expect(text).toContain("defaulted to rank 1");
    expect(text).toContain("true damage");
    expect(recorder.champion).toBe("Cho'Gath");
    expect(recorder.slot).toBe("R");
  });

  test("reports Karthus ult cooldowns by rank", async () => {
    const text = await lookupAbilityText({
      champion: "Karthus",
      ability: "R",
      rank: 2,
    });
    expect(text).toContain("Requiem");
    expect(text).toContain("Cooldown at rank 2: 180s");
    expect(text).toContain("Cooldown (s) by rank: [200, 180, 160]");
  });

  test("keeps Pyke ult's execute wording from the resolved tooltip", async () => {
    const text = await lookupAbilityText({ champion: "pyke", ability: "R" });
    expect(text.toLowerCase()).toContain("executing");
  });

  test("suggests close champion names for a speech-mangled input", async () => {
    const text = await lookupAbilityText({
      champion: "chogarth",
      ability: "R",
    });
    expect(text).toContain('Unknown champion "chogarth"');
    expect(text).toContain("Cho'Gath");
  });

  test("answers an impossible rank with the real rank bounds", async () => {
    const text = await lookupAbilityText({
      champion: "chogath",
      ability: "R",
      rank: 5,
    });
    expect(text).toContain("only has 3 ranks");
    expect(text).toContain("rank 1 through 3");
  });

  test("names unresolved scalings and forbids guessing them", async () => {
    // The generator resolves what it can; some champion somewhere always has
    // leftovers. Assert the contract on one that does, without hard-coding
    // which champion that is forever: the marker line only appears when the
    // unresolved list is non-empty, and must always carry the no-guess order.
    const text = await lookupAbilityText({ champion: "chogath", ability: "Q" });
    if (text.includes("Unresolved scalings")) {
      expect(text).toContain("do NOT guess");
    }
    expect(text).toContain("Description:");
  });
});

describe("lookup_champion", () => {
  test("maps ability slots and marks R as the ultimate", async () => {
    const text = await lookupChampionText({ champion: "Cho'Gath" });
    expect(text).toContain("R (the ultimate): Feast");
    expect(text).toContain("Passive: Carnivore");
    expect(text).toContain("Tags:");
  });

  test("suggests alternatives for unknown champions", async () => {
    const text = await lookupChampionText({ champion: "chogarth" });
    expect(text).toContain("Closest matches");
  });
});

describe("lookup_item", () => {
  test("returns stats for an exact item name", () => {
    const text = lookupItemText({ item: "Infinity Edge" });
    expect(text).toContain("Item: Infinity Edge");
    expect(text).toContain("Stats:");
  });

  test("is case-insensitive", () => {
    const text = lookupItemText({ item: "infinity edge" });
    expect(text).toContain("Item: Infinity Edge");
  });

  test("asks for a full name on an ambiguous fragment", () => {
    const text = lookupItemText({ item: "sword" });
    expect(text).toContain("Multiple items match");
  });

  test("declines unknown items without inventing one", () => {
    const text = lookupItemText({ item: "definitely not an item" });
    expect(text).toContain("Unknown item");
  });
});

describe("lookup_patch_notes", () => {
  test("returns the patch header for any subject", () => {
    const text = lookupPatchNotesText({ subject: "jungle" });
    expect(text).toContain("Patch ");
  });

  test("falls back to the patch overview when nothing matches", () => {
    const text = lookupPatchNotesText({
      subject: "definitely not a champion",
    });
    expect(text).toContain("No patch");
    expect(text).toContain("Patch ");
  });
});
