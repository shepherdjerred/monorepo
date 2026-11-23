import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clusterIdentity: vi.fn(),
  queryRaw: vi.fn(),
  createMany: vi.fn(),
  findUnique: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => {
  const tx = {
    $queryRaw: (strings: TemplateStringsArray, ...parameters: unknown[]) =>
      strings[0]?.includes("current_setting('cluster_name')") === true
        ? mocks.clusterIdentity(strings)
        : mocks.queryRaw(strings, ...parameters),
    replayRenderPackage: {
      createMany: mocks.createMany,
      findUnique: mocks.findUnique,
    },
  };
  return {
    prisma: {
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
  };
});
const { admitVerifiedReplayPackage } = await import("./registry.ts");

const gameBuild = "16.21.829.8620";
const protocol = "20e09df23c66b85e";
const platformId = "NA1";
const inventorySha = "a".repeat(64);
const reportSha = "b".repeat(64);
const manifestJson = JSON.stringify({
  schemaVersion: 1,
  gameBuild,
  protocol,
  entrypoint: "engine.mjs",
  capabilities: {
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
    rosterCoverage: "all-legal-lineups-and-skins",
    rosterInventorySha256: inventorySha,
  },
  files: [{ path: "engine.mjs", bytes: 1, sha256: "c".repeat(64) }],
});
const manifestSha256 = new Bun.CryptoHasher("sha256")
  .update(manifestJson)
  .digest("hex");
const verified = {
  gameBuild,
  protocol,
  manifestJson,
  manifestSha256,
  manifestPath: `/replay-assets/${gameBuild}/${manifestSha256}/manifest.json`,
  admissionJson: {
    schemaVersion: 1,
    manifestSha256,
    rosterInventorySha256: inventorySha,
    nativeComparison: {
      gameBuild,
      reportPath: `/replay-evidence/${reportSha}/report.json`,
      reportSha256: reportSha,
      referenceCaptureSha256: "d".repeat(64),
      result: "perceptual-equivalence",
      coverage: "whole-match-visual-audio-and-spectator-controls",
    },
  },
} as const;
const input = { stage: "beta", platformId, verified } as const;
const observation = {
  platformId,
  gameBuild,
  patch: "16.21",
  sourceSha256: "e".repeat(64),
  sourceUrl: `https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/${platformId}/versions?platform=windows`,
};
const originalTime = new Date(Date.now() - 24 * 60 * 60 * 1000);
const stored = {
  ...verified,
  publishedSha256: manifestSha256,
  publishedAt: originalTime,
  admittedAt: originalTime,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.clusterIdentity.mockResolvedValue([
    { clusterName: "scout-beta-postgresql" },
  ]);
  mocks.queryRaw.mockResolvedValue([
    { ...observation, observedAt: new Date() },
  ]);
  mocks.createMany.mockResolvedValue({ count: 1 });
  mocks.findUnique.mockResolvedValue(stored);
});

test("locks the platform observation, inserts immutable bytes and verifies readback", async () => {
  await expect(admitVerifiedReplayPackage(input)).resolves.toBe("admitted");
  expect(mocks.queryRaw).toHaveBeenCalledWith(
    [
      expect.stringContaining('FROM "ReplayPatchObservation"'),
      expect.stringContaining("FOR SHARE"),
    ],
    platformId,
  );
  expect(mocks.createMany).toHaveBeenCalledExactlyOnceWith({
    data: {
      ...verified,
      publishedSha256: manifestSha256,
      publishedAt: expect.any(Date),
      admittedAt: expect.any(Date),
    },
    skipDuplicates: true,
  });
  expect(mocks.findUnique).toHaveBeenCalledExactlyOnceWith({
    where: { gameBuild_protocol: { gameBuild, protocol } },
  });
});

test("production admission verifies the production database cluster", async () => {
  mocks.clusterIdentity.mockResolvedValue([
    { clusterName: "scout-prod-postgresql" },
  ]);
  await expect(
    admitVerifiedReplayPackage({ ...input, stage: "prod" }),
  ).resolves.toBe("admitted");
  expect(mocks.clusterIdentity).toHaveBeenCalledExactlyOnceWith([
    expect.stringContaining("current_setting('cluster_name')"),
  ]);
});

test.each(["scout-prod-postgresql", "", "SCOUT-BETA-POSTGRESQL"])(
  "beta admission rejects a database with cluster name %j before any write",
  async (clusterName) => {
    mocks.clusterIdentity.mockResolvedValue([{ clusterName }]);
    await expect(admitVerifiedReplayPackage(input)).rejects.toThrow(
      "requires the Scout beta database cluster",
    );
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.createMany).not.toHaveBeenCalled();
  },
);

test("an identical registry row is idempotent even with original timestamps", async () => {
  mocks.createMany.mockResolvedValue({ count: 0 });
  await expect(admitVerifiedReplayPackage(input)).resolves.toBe(
    "already_admitted",
  );
});

test("a build/protocol conflict cannot replace the admitted row", async () => {
  mocks.createMany.mockResolvedValue({ count: 0 });
  mocks.findUnique.mockResolvedValue({
    ...stored,
    manifestSha256: "f".repeat(64),
  });
  await expect(admitVerifiedReplayPackage(input)).rejects.toThrow(
    "different immutable admission",
  );
});

test("the manifest and admission must still pass the runtime verifier", async () => {
  await expect(
    admitVerifiedReplayPackage({
      ...input,
      verified: { ...verified, manifestJson: `${manifestJson} ` },
    }),
  ).rejects.toThrow("does not match its immutable manifest");
  expect(mocks.createMany).not.toHaveBeenCalled();
});

test("stale or superseding official observations never write an admission", async () => {
  mocks.queryRaw.mockResolvedValueOnce([
    { ...observation, observedAt: originalTime },
  ]);
  await expect(admitVerifiedReplayPackage(input)).rejects.toThrow(
    "not current",
  );
  mocks.queryRaw.mockResolvedValueOnce([
    {
      ...observation,
      gameBuild: "16.22.834.8910",
      patch: "16.22",
      observedAt: new Date(),
    },
  ]);
  await expect(admitVerifiedReplayPackage(input)).rejects.toThrow(
    "not the latest exact build",
  );
  expect(mocks.createMany).not.toHaveBeenCalled();
});

test("a package without an exact-build upload layout cannot be admitted", async () => {
  await expect(
    admitVerifiedReplayPackage({
      ...input,
      verified: { ...verified, gameBuild: "16.22.834.8910" },
    }),
  ).rejects.toThrow("Unsupported container build/protocol");
  expect(mocks.queryRaw).not.toHaveBeenCalled();
});
