import type {
  LegacyActivityPage,
  LegacyActivityQuery,
} from "#shared/legacy-activity/contract.ts";

const movieId = "f6e1ef3f-62e2-4373-9b73-57ffeec95696";
const manager = {
  table: "history",
  provider: null,
  actionCode: null,
  fileId: null,
  qualityId: null,
  customFormatScore: null,
} as const;
const fixturePage: LegacyActivityPage["items"] = [
  {
    id: "1d29b7ce-a8bc-4d3f-a536-eca3792e57ee",
    event: {
      ...manager,
      source: "sonarr",
      sourceInstanceId: "9fb8d288-6de6-4a25-8891-949b7be9641b",
      originalId: 438,
      sourceDate: "2026-09-28T22:18:01Z",
      action: "downloadFolderImported",
      episodeId: 63,
      seriesId: 27,
    },
  },
  {
    id: movieId,
    event: {
      ...manager,
      source: "radarr",
      sourceInstanceId: "31b72d44-11fc-4411-9bc8-6304a2c588a4",
      originalId: 228,
      sourceDate: "2026-09-28T16:49:13Z",
      action: "grabbed",
      movieId: 50,
      provider: "Example Indexer",
    },
  },
  {
    id: "02fbb4b5-b824-4e7f-9170-a92c54df0032",
    event: {
      source: "bazarr",
      sourceInstanceId: "87f50ca7-ac69-48be-8380-7ae6bcea04a5",
      table: "episode",
      originalId: 150,
      sourceDate: "2026-09-27T03:02:58.123456Z",
      action: 1,
      mediaId: 31,
      seriesId: 11,
      provider: "Example Subtitles",
      language: "en:forced",
      score: 100,
      scoreOutOf: 100,
      upgradedFromId: null,
    },
  },
];

export function importedActivityPage(
  query: LegacyActivityQuery,
): LegacyActivityPage {
  const rows = fixturePage.filter(
    (item) => query.source === "imported" || item.event.source === query.source,
  );
  // Two fixture rows per page are enough to demonstrate the continuation.
  const start =
    query.before === undefined
      ? 0
      : rows.findIndex((row) => row.id === query.before) + 1;
  const items = rows.slice(start, start + 2);
  return {
    items,
    nextCursor: rows.length > start + 2 ? (items.at(-1)?.id ?? null) : null,
  };
}
