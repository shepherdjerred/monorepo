import type { PublicReplayDescriptor } from "@scout-for-lol/domain/artifacts/public-replay.ts";

export const replayFixture = {
  replayId: "776ca413-9b18-4930-b6d2-33c5b4152cda",
  matchId: "NA1_1234567890",
  platformId: "NA1",
  gameId: "1234567890",
  gameBuild: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  durationSeconds: 1534.5,
  mapId: 11,
  gameMode: "CLASSIC",
  teamSizes: [5, 5],
  bytes: 8_161_849,
  sha256: "a".repeat(64),
  playback: {
    status: "support_preparing",
    latestPatch: "16.21",
    reason: "render_package_unavailable",
  },
} satisfies PublicReplayDescriptor;
