import { describe, expect, test } from "vitest";
import {
  buildPatchChanges,
  patchChangesFromHtml,
} from "#src/data-dragon/patch-changes-build.ts";
import {
  decodeEntities,
  parsePatchNotes,
  type ParsedPatchNotes,
} from "#src/data-dragon/patch-changes-parser.ts";

const ARCHIVE = `${import.meta.dir}/../../patch-notes-archive`;

async function parseArchived(patch: string): Promise<ParsedPatchNotes> {
  return await parsePatchNotes(
    await Bun.file(`${ARCHIVE}/${patch}.html`).text(),
  );
}

// Counts pinned per archived page: blocks under each section, before/after
// lines, and lines that are not before/after changes (bugfix notes, new-ability
// descriptions, "Unchanged", scoreboard lists).
const PAGES = [
  {
    patch: "26.14",
    date: "2026-07-14",
    champions: 10,
    items: 3,
    changes: 26,
    skipped: 4,
  },
  {
    patch: "26.15",
    date: "2026-07-28",
    champions: 11,
    items: 3,
    changes: 65,
    skipped: 3,
  },
  {
    patch: "26.16",
    date: "2026-08-11",
    champions: 7,
    items: 10,
    changes: 38,
    skipped: 1,
  },
  {
    patch: "26.17",
    date: "2026-08-25",
    champions: 14,
    items: 2,
    changes: 32,
    skipped: 0,
  },
  {
    patch: "26.18",
    date: "2026-09-09",
    champions: 11,
    items: 1,
    changes: 28,
    skipped: 2,
  },
  {
    patch: "26.19",
    date: "2026-09-22",
    champions: 17,
    items: 1,
    changes: 38,
    skipped: 0,
  },
  {
    patch: "26.20",
    date: "2026-10-06",
    champions: 16,
    items: 3,
    changes: 34,
    skipped: 16,
  },
  {
    patch: "26.21",
    date: "2026-10-20",
    champions: 25,
    items: 4,
    changes: 55,
    skipped: 9,
  },
  {
    patch: "26.22",
    date: "2026-11-03",
    champions: 14,
    items: 2,
    changes: 40,
    skipped: 7,
  },
  {
    patch: "26.23",
    date: "2026-11-17",
    champions: 13,
    items: 1,
    changes: 26,
    skipped: 1,
  },
];

describe("archived patch pages", () => {
  test.each(PAGES)(
    "$patch parses to the pinned counts",
    async ({ patch, date, champions, items, changes, skipped }) => {
      const parsed = await parseArchived(patch);
      expect(parsed.patch).toBe(patch);
      expect(parsed.date).toBe(date);
      expect(parsed.subjects.filter((s) => s.kind === "champion")).toHaveLength(
        champions,
      );
      expect(parsed.subjects.filter((s) => s.kind === "item")).toHaveLength(
        items,
      );
      expect(parsed.changes).toHaveLength(changes);
      expect(parsed.skipped).toHaveLength(skipped);
    },
  );

  test("every archived page is covered above", async () => {
    const names = [...new Bun.Glob("*.html").scanSync({ cwd: ARCHIVE })].map(
      (name) => name.replace(".html", ""),
    );
    expect(names.toSorted()).toEqual(PAGES.map((page) => page.patch));
  });
});

describe("named cases", () => {
  test("26.19 Aatrox W cooldown", async () => {
    const parsed = await parseArchived("26.19");
    expect(parsed.changes[0]).toEqual({
      kind: "champion",
      subject: "Aatrox",
      ability: { slot: "W", name: "Infernal Chains" },
      stat: "Cooldown",
      before: "20 / 18 / 16 / 14 / 12 seconds",
      after: "18 / 16.5 / 15 / 13.5 / 12 seconds",
    });
  });

  test("26.19 Aphelios weapons carry a name but no slot", async () => {
    const parsed = await parseArchived("26.19");
    const calibrum = parsed.changes.find((c) => c.stat === "Moonshot Damage");
    expect(calibrum?.ability).toEqual({ slot: null, name: "Calibrum" });
  });

  test("26.19 base stats have no ability", async () => {
    const parsed = await parseArchived("26.19");
    const draven = parsed.changes.find((c) => c.subject === "Draven");
    expect(draven).toMatchObject({
      ability: null,
      stat: "Attack Damage",
      before: "62",
      after: "64",
    });
  });

  test("26.17 Graves lines sit directly under the champion with a slot heading", async () => {
    const parsed = await parseArchived("26.17");
    const graves = parsed.changes.filter((c) => c.subject === "Graves");
    expect(graves.map((c) => c.stat)).toEqual([
      "Initial Damage",
      "Return Damage",
    ]);
    expect(graves[0]?.ability).toEqual({ slot: "Q", name: "End of the Line" });
  });

  test("26.17 LeBlanc's recast heading keeps its RW slot", async () => {
    const parsed = await parseArchived("26.17");
    const mimic = parsed.changes.find(
      (c) => c.subject === "LeBlanc" && c.ability?.slot === "RW",
    );
    expect(mimic?.ability?.name).toBe("Mimic: Distortion");
  });

  test("26.19 an item block headed only by an h4 names the item", async () => {
    const parsed = await parseArchived("26.19");
    const items = parsed.changes.filter((c) => c.kind === "item");
    expect(items.map((c) => [c.subject, c.stat])).toEqual([
      ["World Atlas and Runic Compass", "Health"],
      ["World Atlas and Runic Compass", "Health Regeneration"],
    ]);
  });

  test("26.22 rejoins a change split over two list items", async () => {
    const parsed = await parseArchived("26.22");
    const zaahen = parsed.changes.find((c) => c.subject === "Zaahen");
    expect(zaahen).toMatchObject({
      ability: { slot: "Q", name: "The Darkin Glaive" },
      stat: "Cooldown",
      before: "10 / 9 / 8 / 7 / 6s",
      after: "8 / 7.5 / 7 / 6.5 / 6s",
    });
  });

  test("26.22 reads a change written as a paragraph", async () => {
    const parsed = await parseArchived("26.22");
    expect(
      parsed.changes.find(
        (c) => c.subject === "Overlord's Bloodmail" && c.stat === "Retribution",
      ),
    ).toBeDefined();
  });

  test("26.23 an item passive heading becomes the ability", async () => {
    const parsed = await parseArchived("26.23");
    expect(
      parsed.changes.find((c) => c.subject === "Voltaic Cyclosword"),
    ).toMatchObject({
      ability: { slot: null, name: "Firmament Unique" },
      stat: "Bonus Damage",
    });
  });

  test("26.14 reports bugfix lines as skipped instead of dropping them", async () => {
    const parsed = await parseArchived("26.14");
    expect(parsed.skipped.map((line) => line.subject)).toEqual([
      "Azir",
      "Azir",
      "Azir",
      "Azir",
    ]);
  });

  test("26.21 ignores a stat with ⇒ Unchanged and keeps real ones", async () => {
    const parsed = await parseArchived("26.21");
    expect(parsed.changes.some((c) => c.after === "Unchanged")).toBe(false);
  });
});

describe("resolved subjects and directions", () => {
  test("26.19 splits a two-item block and maps ids", async () => {
    const lines = await patchChangesFromHtml(
      await Bun.file(`${ARCHIVE}/26.19.html`).text(),
    );
    const atlas = lines.filter((line) => line.subject.kind === "item");
    expect(
      atlas.map((line) => [line.subject.id, line.subject.name, line.stat]),
    ).toEqual([
      [3865, "World Atlas", "Health"],
      [3866, "Runic Compass", "Health"],
      [3865, "World Atlas", "Health Regeneration"],
      [3866, "Runic Compass", "Health Regeneration"],
    ]);
  });

  test("26.19 Aatrox W cooldown is a buff", async () => {
    const lines = await patchChangesFromHtml(
      await Bun.file(`${ARCHIVE}/26.19.html`).text(),
    );
    const cooldown = lines.find(
      (line) => line.subject.name === "Aatrox" && line.stat === "Cooldown",
    );
    expect(cooldown).toMatchObject({
      patch: "26.19",
      date: "2026-09-22",
      subject: { kind: "champion", id: 266, name: "Aatrox" },
      ability: { slot: "W", name: "Infernal Chains" },
      direction: "buff",
    });
  });

  test("26.16 maps a renamed item to its current id", async () => {
    const lines = await patchChangesFromHtml(
      await Bun.file(`${ARCHIVE}/26.16.html`).text(),
    );
    const sunfire = lines.find((line) => line.subject.name === "Sunfire Cape");
    expect(sunfire?.subject.id).toBe(3068);
  });

  test("an unknown champion fails loudly", () => {
    expect(() =>
      buildPatchChanges({
        patch: "26.99",
        date: "2026-01-01",
        subjects: [],
        skipped: [],
        changes: [
          {
            kind: "champion",
            subject: "Not A Champion",
            ability: null,
            stat: "Health",
            before: "1",
            after: "2",
          },
        ],
      }),
    ).toThrow("not in the champion registry");
  });

  test("an unknown item fails loudly", () => {
    expect(() =>
      buildPatchChanges({
        patch: "26.99",
        date: "2026-01-01",
        subjects: [],
        skipped: [],
        changes: [
          {
            kind: "item",
            subject: "Not An Item",
            ability: null,
            stat: "Cost",
            before: "1",
            after: "2",
          },
        ],
      }),
    ).toThrow("not in the item catalog");
  });
});

describe("decodeEntities", () => {
  test("decodes named and numeric references", () => {
    expect(decodeEntities("a&nbsp;b &amp; &#39;c&#x27;")).toBe("a b & 'c'");
  });

  test("rejects a reference it does not know", () => {
    expect(() => decodeEntities("&hellip;")).toThrow("Unhandled HTML entity");
  });
});
