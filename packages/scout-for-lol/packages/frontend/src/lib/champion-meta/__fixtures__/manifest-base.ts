/** Manifest fields shared by the champion-meta test fixtures; each test adds its own champions. */
export const BASE_MANIFEST = {
  schemaVersion: 1,
  buildId: "build-1",
  generatedAt: "2026-01-08T00:00:00.000Z",
  source: { firstDay: "2026-01-01", lastDay: "2026-01-07", days: 7 },
  thresholds: { minSliceGames: 100, minEntryGames: 20, minMatchupGames: 30 },
  patches: ["16.3"],
  queues: [{ id: 420, label: "ranked_solo" }],
  brackets: ["all"],
  tiers: [],
  defaults: { patch: "16.3", queueId: 420, bracket: "all" },
};
