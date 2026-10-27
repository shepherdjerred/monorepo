import { describe, expect, test } from "vitest";
import {
  getPatchChangeset,
  PatchChangesetSchema,
  type PatchChangeset,
} from "#src/data-dragon/patch-notes.ts";

function buildChangeset(): PatchChangeset {
  return PatchChangesetSchema.parse({
    patch: "26.13",
    title: "Patch 26.13 Notes",
    url: "https://example.com/patch-26-13",
    date: "2026 07 01",
    overview: "A jungle-focused patch that nudges bot lane down a notch.",
    themes: ["jungle buffs"],
    summary: ["Junglers eat better early", "Marksmen spike later"],
    champions: [
      {
        name: "Lee Sin",
        direction: "buff",
        magnitude: "major",
        summary: "Q damage up",
        details: "Lee Sin's early skirmishing is much stronger this patch.",
      },
      {
        name: "Yasuo",
        direction: "nerf",
        magnitude: "minor",
        summary: "Windwall cooldown up",
        details:
          "Yasuo's windwall is up longer, softening his lane bully phase.",
      },
    ],
    items: [
      {
        name: "Boots",
        direction: "buff",
        magnitude: "moderate",
        summary: "Cheaper",
        details: "Boots cost less, smoothing out early spikes.",
      },
      {
        name: "Some Item That Does Not Exist",
        direction: "nerf",
        magnitude: "major",
        summary: "Gutted",
        details: "Irrelevant to the player.",
      },
    ],
    systems: [
      {
        area: "Jungle",
        direction: "buff",
        magnitude: "moderate",
        summary: "Camp gold up",
        details: "Jungle camps grant more gold, rewarding proactive clears.",
      },
      {
        area: "Support items",
        direction: "nerf",
        magnitude: "minor",
        summary: "Ward cost up",
        details: "Support item wards cost more.",
      },
    ],
  });
}

describe("getPatchChangeset", () => {
  test("parses the bundled seed asset", () => {
    const changeset = getPatchChangeset();
    expect(changeset).toBeDefined();
    expect(changeset?.patch).toMatch(/^\d+\.\d+$/);
    expect(changeset?.overview.length).toBeGreaterThan(0);
    expect(changeset?.summary.length).toBeGreaterThanOrEqual(1);
  });
});

describe("changelogHighlights", () => {
  test("defaults to [] for assets written before the field existed", () => {
    // buildChangeset() omits changelogHighlights, mirroring an older asset.
    expect(buildChangeset().changelogHighlights).toEqual([]);
  });

  test("accepts up to four Scout-capability bullets", () => {
    const changeset = PatchChangesetSchema.parse({
      ...buildChangeset(),
      changelogHighlights: ["Ranked 5v5 is now supported"],
    });
    expect(changeset.changelogHighlights).toEqual([
      "Ranked 5v5 is now supported",
    ]);
  });

  test("rejects more than four bullets", () => {
    expect(() =>
      PatchChangesetSchema.parse({
        ...buildChangeset(),
        changelogHighlights: ["a", "b", "c", "d", "e"],
      }),
    ).toThrow();
  });
});
