export function admittedReplayRenderPackageFixture({
  gameBuild,
  protocol,
  publishedAt,
  admittedAt,
}: {
  gameBuild: string;
  protocol: string;
  publishedAt: Date;
  admittedAt: Date;
}) {
  const rosterInventorySha256 = "d".repeat(64);
  const reportSha256 = "f".repeat(64);
  const manifestJson = JSON.stringify({
    schemaVersion: 1,
    gameBuild,
    protocol,
    entrypoint: "runtime/index.js",
    capabilities: {
      mapId: 11,
      gameMode: "CLASSIC",
      teamSizes: [5, 5],
      rosterCoverage: "all-legal-lineups-and-skins",
      rosterInventorySha256,
    },
    files: [{ path: "runtime/index.js", sha256: "e".repeat(64), bytes: 32 }],
  });
  const manifestSha256 = new Bun.CryptoHasher("sha256")
    .update(manifestJson)
    .digest("hex");
  return {
    gameBuild,
    protocol,
    manifestSha256,
    manifestPath: `/replay-assets/${gameBuild}/${manifestSha256}/manifest.json`,
    manifestJson,
    publishedSha256: manifestSha256,
    publishedAt,
    admittedAt,
    admissionJson: {
      schemaVersion: 1,
      manifestSha256,
      rosterInventorySha256,
      nativeComparison: {
        gameBuild,
        reportPath: `/replay-evidence/${reportSha256}/report.json`,
        reportSha256,
        referenceCaptureSha256: "1".repeat(64),
        result: "perceptual-equivalence",
        coverage: "whole-match-visual-audio-and-spectator-controls",
      },
    },
  };
}
