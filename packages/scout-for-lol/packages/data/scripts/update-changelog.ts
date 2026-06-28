// Pure helpers for inserting an auto-generated "What's New" entry into the
// frontend changelog (packages/frontend/src/data/changelog.tsx).
//
// Kept side-effect free (no file or network I/O) so the version-gating and
// source-rewriting logic is unit-testable. `update-data-dragon.ts` reads the
// file, calls these, writes it back, and runs prettier.

/**
 * Color palette for a changelog section. Mirrors `ChangelogColor` in
 * packages/frontend/src/data/changelog.tsx — keep in sync. The frontend
 * typecheck validates the generated source, so a drifted value fails loudly.
 */
export type ChangelogColor =
  | "yellow"
  | "indigo"
  | "blue"
  | "purple"
  | "green"
  | "red"
  | "pink"
  | "teal";

export type ChangelogSectionInput = {
  title: string;
  color: ChangelogColor;
  items: string[];
};

export type ChangelogEntryInput = {
  /** Display date in `"YYYY MM DD"` form. */
  date: string;
  banner: string;
  sections: ChangelogSectionInput[];
};

const CHANGELOG_ANCHOR = "export const changelog: ChangelogEntry[] = [";

/** Derive the `major.minor` key (e.g. `"16.13.1" → "16.13"`). */
export function minorVersionKey(version: string): string {
  const parts = version.split(".");
  if (parts.length < 2 || parts[0] === "" || parts[1] === "") {
    throw new Error(
      `Cannot derive minor version key from ${JSON.stringify(version)}`,
    );
  }
  return `${parts[0]}.${parts[1]}`;
}

/**
 * True only when the minor version changes (`16.13.x → 16.14.x`). Hotfix
 * micro-bumps (`16.13.1 → 16.13.2`) and unchanged versions return false, so the
 * auto-merged Data Dragon path never spams the changelog.
 */
export function isMinorVersionBump(previous: string, next: string): boolean {
  return minorVersionKey(previous) !== minorVersionKey(next);
}

/** Format a `Date` as the `"YYYY MM DD"` string the changelog expects. */
export function formatDateForChangelog(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year} ${month} ${day}`;
}

function serializeStringArray(items: string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(", ")}]`;
}

/**
 * Render a structured entry as `buildChangelogEntry({...})` TypeScript source.
 * Output is roughly formatted; the caller runs prettier to normalize it.
 */
export function buildChangelogEntryLiteral(input: ChangelogEntryInput): string {
  if (input.sections.length === 0) {
    throw new Error("Changelog entry must have at least one section");
  }
  const sections = input.sections
    .map((section) =>
      [
        "      {",
        `        title: ${JSON.stringify(section.title)},`,
        `        color: ${JSON.stringify(section.color)},`,
        `        items: ${serializeStringArray(section.items)},`,
        "      },",
      ].join("\n"),
    )
    .join("\n");
  return [
    "  buildChangelogEntry({",
    `    date: ${JSON.stringify(input.date)},`,
    `    banner: ${JSON.stringify(input.banner)},`,
    "    sections: [",
    sections,
    "    ],",
    "  }),",
  ].join("\n");
}

/**
 * Insert an entry literal at the top of the `changelog` array (newest-first).
 * Throws if the anchor is missing so a refactor of changelog.tsx fails loudly
 * instead of silently dropping the entry.
 */
export function insertChangelogEntry(
  source: string,
  entryLiteral: string,
): string {
  const index = source.indexOf(CHANGELOG_ANCHOR);
  if (index === -1) {
    throw new Error(
      `Could not find changelog anchor ${JSON.stringify(CHANGELOG_ANCHOR)} in source`,
    );
  }
  const insertAt = index + CHANGELOG_ANCHOR.length;
  return `${source.slice(0, insertAt)}\n${entryLiteral}${source.slice(insertAt)}`;
}

/**
 * Build the templated changelog entry literal for a Data Dragon patch bump.
 * Banner/section copy is intentionally minimal — this rides the auto-merged PR.
 */
export function buildPatchChangelogEntryLiteral(
  version: string,
  date: Date,
): string {
  const minor = minorVersionKey(version);
  return buildChangelogEntryLiteral({
    date: formatDateForChangelog(date),
    banner: `Patch ${minor} support — latest champion, item, and rune data`,
    sections: [
      {
        title: "Game Data",
        color: "indigo",
        items: [
          `Updated champion, item, summoner spell, and rune data to League patch ${minor}`,
        ],
      },
    ],
  });
}
