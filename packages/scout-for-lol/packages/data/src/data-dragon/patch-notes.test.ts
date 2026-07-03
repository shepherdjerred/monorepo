import { describe, expect, test } from "bun:test";
import {
  getPatchChangeset,
  selectRelevantPatchChanges,
  formatPatchNotes,
  PatchChangesetSchema,
  type PatchChangeset,
} from "#src/data-dragon/patch-notes.ts";
import { getItemInfo } from "#src/data-dragon/item.ts";

// A stable item that always exists in Data Dragon; we read its canonical name at
// runtime so the item-matching test doesn't hardcode a version-specific string.
const BOOTS_ITEM_ID = 1001;
const bootsName = getItemInfo(BOOTS_ITEM_ID)?.name ?? "Boots";

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
        name: bootsName,
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
    expect(changeset?.patch).toBe("26.13");
    expect(changeset?.overview.length).toBeGreaterThan(0);
    expect(changeset?.summary.length).toBeGreaterThanOrEqual(1);
  });
});

describe("selectRelevantPatchChanges", () => {
  test("keeps only changes touching the player's champs, role, and items", () => {
    const changeset = buildChangeset();
    const subset = selectRelevantPatchChanges(changeset, {
      // Data Dragon key form (no space) — must still match "Lee Sin"
      champions: ["LeeSin"],
      lanes: ["jungle"],
      items: [BOOTS_ITEM_ID],
    });

    expect(subset.champions.map((c) => c.name)).toEqual(["Lee Sin"]);
    expect(subset.systems.map((s) => s.area)).toEqual(["Jungle"]);
    expect(subset.items.map((i) => i.name)).toEqual([bootsName]);
  });

  test("ranks matched champion changes by magnitude (major first)", () => {
    const changeset = buildChangeset();
    const subset = selectRelevantPatchChanges(changeset, {
      champions: ["Yasuo", "LeeSin"],
      lanes: [],
      items: [],
    });
    expect(subset.champions.map((c) => c.name)).toEqual(["Lee Sin", "Yasuo"]);
  });

  test("drops everything when nothing matches", () => {
    const changeset = buildChangeset();
    const subset = selectRelevantPatchChanges(changeset, {
      champions: ["Teemo"],
      lanes: ["top"],
      items: [],
    });
    expect(subset.champions).toEqual([]);
    expect(subset.systems).toEqual([]);
    expect(subset.items).toEqual([]);
  });
});

describe("formatPatchNotes", () => {
  test("renders targeted changes with prose details", () => {
    const changeset = buildChangeset();
    const subset = selectRelevantPatchChanges(changeset, {
      champions: ["LeeSin"],
      lanes: ["jungle"],
      items: [],
    });
    const text = formatPatchNotes(changeset, subset);
    expect(text).toContain("PATCH 26.13");
    expect(text).toContain("Lee Sin (buff, major)");
    expect(text).toContain("Jungle (buff, moderate)");
  });

  test("falls back to overview + summary bullets when nothing matches", () => {
    const changeset = buildChangeset();
    const subset = selectRelevantPatchChanges(changeset, {
      champions: ["Teemo"],
      lanes: ["top"],
      items: [],
    });
    const text = formatPatchNotes(changeset, subset);
    expect(text).toContain(changeset.overview);
    expect(text).toContain("Junglers eat better early");
    expect(text).not.toContain("Lee Sin");
  });

  test("returns empty string when there is no changeset", () => {
    const noChangeset: PatchChangeset | undefined = undefined;
    expect(formatPatchNotes(noChangeset)).toBe("");
  });
});
