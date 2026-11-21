import type { z } from "zod";
import {
  LibraryCursorSchema,
  LibraryQuerySchema,
  type LibraryPageSchema,
} from "#shared/household/library.ts";
import type { Persona } from "#testing/fixture-api/personas.ts";
import { pick, versionOf } from "#testing/fixture-api/support.ts";
import { TITLES } from "./titles.ts";

type LibraryPage = z.input<typeof LibraryPageSchema>;
type LibraryItem = LibraryPage["items"][number];

const POLICIES = [
  "keep",
  "temporary",
  "keep",
  "temporary",
  "unclassified",
] as const;
const INTERESTS = ["following", "none", "released", "none"] as const;
const PROTECTION = {
  keep: "keep_indefinitely",
  temporary: "temporary_interest",
  unclassified: "review_required",
} as const;

function libraryItems(persona: Persona): LibraryItem[] {
  return TITLES.map((title): LibraryItem => {
    const policy = pick(POLICIES, title.index);
    return {
      id: title.id,
      title: title.title,
      kind: title.kind,
      // A few provider records carry no year or no observed availability.
      year: title.index % 17 === 16 ? null : title.year,
      policy,
      myInterest: pick(INTERESTS, title.index),
      availability: title.index % 13 === 12 ? null : title.availability,
      protection: PROTECTION[policy],
      libraryKeeping:
        persona === "owner" && policy !== "unclassified"
          ? {
              mediaVersion: versionOf(title.id),
              targetVersion: (title.index % 4) + 1,
              keepingPolicy: policy,
            }
          : null,
    };
  }).sort((left, right) => left.title.localeCompare(right.title));
}

/** Title-ordered, cursor-paged library, filtered the way the server filters. */
export function libraryPage(
  parameters: URLSearchParams,
  persona: Persona,
): LibraryPage {
  const query = LibraryQuerySchema.parse(Object.fromEntries(parameters));
  const needle = query.query.toLowerCase();
  const matching = libraryItems(persona).filter(
    (item) =>
      (query.kind === "all" || item.kind === query.kind) &&
      item.title.toLowerCase().includes(needle),
  );
  let remaining = matching;
  if (query.cursor !== null) {
    const cursor = LibraryCursorSchema.parse(JSON.parse(query.cursor));
    const position = matching.findIndex((item) => item.id === cursor.id);
    if (position === -1) {
      throw new Error(`Library cursor names an unknown title ${cursor.id}`);
    }
    remaining = matching.slice(position + 1);
  }
  const items = remaining.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      last !== undefined && remaining.length > query.limit
        ? JSON.stringify({ title: last.title, id: last.id })
        : null,
  };
}
