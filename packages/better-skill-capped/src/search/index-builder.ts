import { create, insertMultiple } from "@orama/orama";
import type { SearchDoc } from "./search-doc.ts";

export const SEARCH_SCHEMA = {
  title: "string",
  description: "string",
  childTitles: "string",
  champions: "string",
  staffText: "string",
  searchAux: "string",
  kind: "enum",
  role: "enum",
  staff: "enum",
  yourChampion: "enum",
  theirChampion: "enum",
  tags: "enum[]",
  carry: "enum",
  commentaryType: "enum",
  recommended: "boolean",
  releaseDate: "number",
  durationInSeconds: "number",
} as const;

function buildEmptyIndex() {
  return create({ schema: SEARCH_SCHEMA });
}

export type SearchIndex = ReturnType<typeof buildEmptyIndex>;

/**
 * Builds the single unified index over all ~6.3k docs. Cheap enough (tens of
 * milliseconds) to rebuild whenever the manifest itself changes — and only
 * then; filters, bookmarks, and watch toggles never trigger a rebuild.
 */
export async function createSearchIndex(
  docs: SearchDoc[],
): Promise<SearchIndex> {
  const index = buildEmptyIndex();
  await insertMultiple(index, docs);
  return index;
}
