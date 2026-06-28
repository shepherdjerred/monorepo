import { describe, expect, test } from "bun:test";
import {
  buildChangelogEntryLiteral,
  buildPatchChangelogEntryLiteral,
  formatDateForChangelog,
  insertChangelogEntry,
  isMinorVersionBump,
  minorVersionKey,
} from "./update-changelog.ts";
import type { RiotPatch } from "./riot-patch.ts";

const SAMPLE_PATCH: RiotPatch = {
  patch: "26.14",
  major: 26,
  minor: 14,
  title: "League of Legends Patch 26.14 Notes",
  tagline: "Big things this patch",
  url: "https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-14-notes",
};

const SAMPLE_SOURCE = `import type { ReactNode } from "react";

export const changelog: ChangelogEntry[] = [
  {
    date: "2026 05 23",
    banner: <>existing</>,
    text: <></>,
    formatted: { year: 2026, month: 5, day: 23 },
  },
];
`;

describe("minorVersionKey", () => {
  test("drops the patch component", () => {
    expect(minorVersionKey("16.13.1")).toBe("16.13");
    expect(minorVersionKey("16.14")).toBe("16.14");
  });

  test("throws on a version without a minor component", () => {
    expect(() => minorVersionKey("16")).toThrow();
    expect(() => minorVersionKey("")).toThrow();
  });
});

describe("isMinorVersionBump", () => {
  test("false for a hotfix micro-bump", () => {
    expect(isMinorVersionBump("16.13.1", "16.13.2")).toBe(false);
  });

  test("false for an unchanged version", () => {
    expect(isMinorVersionBump("16.13.1", "16.13.1")).toBe(false);
  });

  test("true for a minor bump", () => {
    expect(isMinorVersionBump("16.13.1", "16.14.1")).toBe(true);
  });

  test("true for a major bump", () => {
    expect(isMinorVersionBump("16.24.1", "17.1.1")).toBe(true);
  });
});

describe("formatDateForChangelog", () => {
  test("renders space-separated, zero-padded YYYY MM DD", () => {
    // Month is 0-indexed in Date: 5 → June → "06".
    expect(formatDateForChangelog(new Date(2026, 5, 28))).toBe("2026 06 28");
    expect(formatDateForChangelog(new Date(2026, 0, 1))).toBe("2026 01 01");
  });
});

describe("buildChangelogEntryLiteral", () => {
  test("emits a buildChangelogEntry call with the given content", () => {
    const literal = buildChangelogEntryLiteral({
      date: "2026 06 28",
      banner: "Patch 16.14 support",
      sections: [
        { title: "Game Data", color: "indigo", items: ["Updated to 16.14"] },
      ],
    });
    expect(literal).toContain("buildChangelogEntry({");
    expect(literal).toContain('date: "2026 06 28"');
    expect(literal).toContain('banner: "Patch 16.14 support"');
    expect(literal).toContain('title: "Game Data"');
    expect(literal).toContain('color: "indigo"');
    expect(literal).toContain('items: ["Updated to 16.14"]');
  });

  test("escapes special characters via JSON serialization", () => {
    const literal = buildChangelogEntryLiteral({
      date: "2026 06 28",
      banner: 'Quote " and backslash \\ inside',
      sections: [{ title: "T", color: "blue", items: ["a"] }],
    });
    expect(literal).toContain('banner: "Quote \\" and backslash \\\\ inside"');
  });

  test("throws when no sections are supplied", () => {
    expect(() =>
      buildChangelogEntryLiteral({
        date: "2026 06 28",
        banner: "x",
        sections: [],
      }),
    ).toThrow();
  });

  test("omits the link block when no link is given", () => {
    const literal = buildChangelogEntryLiteral({
      date: "2026 06 28",
      banner: "x",
      sections: [{ title: "T", color: "blue", items: ["a"] }],
    });
    expect(literal).not.toContain("link:");
  });

  test("emits a link block when a link is given", () => {
    const literal = buildChangelogEntryLiteral({
      date: "2026 06 28",
      banner: "x",
      sections: [{ title: "T", color: "blue", items: ["a"] }],
      link: { label: "Read more", href: "https://example.com/notes" },
    });
    expect(literal).toContain("link: {");
    expect(literal).toContain('label: "Read more"');
    expect(literal).toContain('href: "https://example.com/notes"');
  });
});

describe("insertChangelogEntry", () => {
  test("inserts the entry at the top of the array, before existing entries", () => {
    const literal = buildPatchChangelogEntryLiteral(
      SAMPLE_PATCH,
      new Date(2026, 5, 28),
    );
    const updated = insertChangelogEntry(SAMPLE_SOURCE, literal);

    const newIndex = updated.indexOf("Updated for League patch 26.14");
    const existingIndex = updated.indexOf("2026 05 23");
    expect(newIndex).toBeGreaterThan(-1);
    expect(existingIndex).toBeGreaterThan(-1);
    // Newest-first: the freshly inserted entry precedes the prior first entry.
    expect(newIndex).toBeLessThan(existingIndex);
    // The original entry is preserved.
    expect(updated).toContain("banner: <>existing</>");
  });

  test("throws when the changelog anchor is missing", () => {
    expect(() => insertChangelogEntry("const x = [];", "entry")).toThrow(
      /anchor/,
    );
  });
});

describe("buildPatchChangelogEntryLiteral", () => {
  test("uses the REAL Riot patch number (26.x), not the Data Dragon version", () => {
    const literal = buildPatchChangelogEntryLiteral(
      SAMPLE_PATCH,
      new Date(2026, 5, 28),
    );
    expect(literal).toContain("Updated for League patch 26.14");
    expect(literal).toContain('date: "2026 06 28"');
    expect(literal).toContain('color: "indigo"');
    expect(literal).toContain("refreshed for League patch 26.14");
    // Must not leak the Data Dragon major (16) into player-facing copy.
    expect(literal).not.toContain("16.14");
  });

  test("includes a direct link to the Riot patch notes", () => {
    const literal = buildPatchChangelogEntryLiteral(
      SAMPLE_PATCH,
      new Date(2026, 5, 28),
    );
    expect(literal).toContain("link: {");
    expect(literal).toContain('label: "Read Riot\'s full Patch 26.14 notes"');
    expect(literal).toContain(`href: ${JSON.stringify(SAMPLE_PATCH.url)}`);
  });
});

describe("patch gating end-to-end", () => {
  // Mirrors maybeAppendChangelogEntry's decision: only minor bumps insert.
  function applyIfMinorBump(
    source: string,
    previous: string,
    next: string,
  ): string {
    if (!isMinorVersionBump(previous, next)) {
      return source;
    }
    return insertChangelogEntry(
      source,
      buildPatchChangelogEntryLiteral(SAMPLE_PATCH, new Date(2026, 5, 28)),
    );
  }

  test("micro-bump leaves the changelog untouched", () => {
    expect(applyIfMinorBump(SAMPLE_SOURCE, "16.13.1", "16.13.2")).toBe(
      SAMPLE_SOURCE,
    );
  });

  test("minor bump inserts exactly one entry", () => {
    const updated = applyIfMinorBump(SAMPLE_SOURCE, "16.13.1", "16.14.1");
    expect(updated).not.toBe(SAMPLE_SOURCE);
    const occurrences = updated.split("buildChangelogEntry({").length - 1;
    expect(occurrences).toBe(1);
  });
});
