import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  provenance: vi.fn(),
  aliases: vi.fn(),
  validate: vi.fn(),
  content: vi.fn(),
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientReplayArtifact: {
      findUniqueOrThrow: mocks.find,
      updateMany: mocks.update,
    },
  },
}));
vi.mock("#src/scout-client/replay/evidence.ts", () => ({
  resolveReplayProvenance: mocks.provenance,
}));
vi.mock("#src/scout-client/identity-alias.ts", () => ({
  lcuUuidsFor: mocks.aliases,
}));
vi.mock("#src/scout-client/replay/container.ts", () => ({
  validateReplayContainer: mocks.validate,
}));
vi.mock("./content.ts", () => ({ openReplayContent: mocks.content }));

const { backfillReplayMetadata, parseReplayBackfillArguments } =
  await import("./backfill.ts");
const { describePublicReplay } = await import("./catalog.ts");
const { resolveReplaySupport } = await import("./support.ts");
const replayId = "58001d3b-f679-4bb6-9b3d-314900818b27";
const bytes = new Uint8Array([1, 2, 3, 4]);
const metadata = {
  gameBuild: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  durationSeconds: 60,
};
const row = {
  id: replayId,
  gameId: "123",
  platformId: "NA1",
  digest: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  objectKey: "private-key",
  bytes: 4n,
  uploadState: "COMPLETED",
  gameBuild: null,
  protocol: null,
  durationSeconds: null,
  mapId: null,
  gameMode: null,
  teamSizes: null,
  updatedAt: new Date("2026-11-13T00:00:00Z"),
  device: { id: "device", ownerId: "160509172704739328", appVersion: "0.1.0" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(row);
  mocks.provenance.mockResolvedValue({
    localPuuid: "p".repeat(78),
    platformId: "NA1",
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
  });
  mocks.aliases.mockResolvedValue([]);
  mocks.validate.mockResolvedValue(metadata);
  mocks.update.mockResolvedValue({ count: 1 });
  mocks.content.mockImplementation(async () => {
    await Promise.resolve();
    return new Blob([bytes]).stream();
  });
});

test("backfill has no implicit bulk target and defaults to dry-run", () => {
  expect(parseReplayBackfillArguments([`--replay-id=${replayId}`])).toEqual({
    replayIds: [replayId],
    apply: false,
  });
  expect(
    parseReplayBackfillArguments([`--replay-id=${replayId}`, "--apply"]).apply,
  ).toBe(true);
  expect(() => parseReplayBackfillArguments([])).toThrow("exact");
  expect(() => parseReplayBackfillArguments(["--all"])).toThrow("Unknown");
  expect(() =>
    parseReplayBackfillArguments([
      `--replay-id=${replayId}`,
      `--replay-id=${replayId}`,
    ]),
  ).toThrow("once");
});

test("dry-run validates actual downloaded bytes and provenance without updating a row", async () => {
  expect(await backfillReplayMetadata(replayId, false)).toEqual({
    replayId,
    outcome: "validated_dry_run",
  });
  expect(mocks.validate).toHaveBeenCalledOnce();
  expect(mocks.validate.mock.calls[0]?.[1]).toBe(4);
  expect(mocks.update).not.toHaveBeenCalled();
});

test("apply persists only validated metadata with a compare-and-set guard", async () => {
  expect(await backfillReplayMetadata(replayId, true)).toEqual({
    replayId,
    outcome: "updated",
  });
  expect(mocks.update).toHaveBeenCalledWith({
    where: {
      id: replayId,
      uploadState: "COMPLETED",
      digest: row.digest,
      objectKey: row.objectKey,
      platformId: row.platformId,
      updatedAt: row.updatedAt,
    },
    data: {
      ...metadata,
      platformId: "NA1",
      mapId: 11,
      gameMode: "CLASSIC",
      teamSizes: [5, 5],
    },
  });
  mocks.update.mockResolvedValue({ count: 0 });
  await expect(backfillReplayMetadata(replayId, true)).rejects.toThrow(
    "changed during validation",
  );
});

test("digest mismatch, absent provenance and noncompleted rows cannot be backfilled", async () => {
  mocks.find.mockResolvedValue({ ...row, digest: "0".repeat(64) });
  await expect(backfillReplayMetadata(replayId, true)).rejects.toThrow(
    "SHA-256",
  );
  expect(mocks.validate).not.toHaveBeenCalled();
  mocks.find.mockResolvedValue(row);
  mocks.provenance.mockResolvedValue(null);
  await expect(backfillReplayMetadata(replayId, true)).rejects.toThrow(
    "provenance",
  );
  mocks.find.mockResolvedValue({ ...row, uploadState: "FAILED" });
  await expect(backfillReplayMetadata(replayId, true)).rejects.toThrow(
    "completed",
  );
  expect(mocks.update).not.toHaveBeenCalled();
});

test("already populated metadata is not rewritten", async () => {
  mocks.find.mockResolvedValue({
    ...row,
    ...metadata,
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
  });
  expect(await backfillReplayMetadata(replayId, true)).toEqual({
    replayId,
    outcome: "already_present",
  });
  expect(mocks.content).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

test.each([false, true])(
  "a legacy unknown platform is revalidated even when other metadata is complete: %s",
  async (populated) => {
    const legacy = {
      ...row,
      ...(populated
        ? { ...metadata, mapId: 11, gameMode: "CLASSIC", teamSizes: [5, 5] }
        : {}),
      platformId: null,
    };
    mocks.find.mockResolvedValue(legacy);
    expect(await backfillReplayMetadata(replayId, false)).toEqual({
      replayId,
      outcome: "validated_dry_run",
    });
    expect(mocks.validate).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled();

    expect(await backfillReplayMetadata(replayId, true)).toEqual({
      replayId,
      outcome: "updated",
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: {
        id: replayId,
        uploadState: "COMPLETED",
        digest: row.digest,
        objectKey: row.objectKey,
        platformId: null,
        updatedAt: row.updatedAt,
      },
      data: {
        ...metadata,
        platformId: "NA1",
        ...(populated
          ? {}
          : { mapId: 11, gameMode: "CLASSIC", teamSizes: [5, 5] }),
      },
    });
  },
);

test("platform repair exposes qualified public identity and becomes idempotent", async () => {
  const legacy = { ...row, ...metadata, platformId: null };
  let repaired = legacy;
  mocks.find.mockResolvedValue(legacy);
  mocks.update.mockImplementation(
    async (input: { where: { id: string }; data: typeof legacy }) => {
      await Promise.resolve();
      expect(input.where.id).toBe(replayId);
      repaired = { ...repaired, ...input.data };
      return { count: 1 };
    },
  );
  const now = new Date("2026-11-13T01:00:00Z");
  const support = (replay: Parameters<typeof resolveReplaySupport>[0]) =>
    resolveReplaySupport(replay, {
      now: () => now,
      observation: async () => {
        await Promise.resolve();
        return {
          platformId: "NA1",
          patch: "16.21",
          gameBuild: metadata.gameBuild,
          sourceUrl:
            "https://sieve.services.riotcdn.net/api/v1/products/lol/version-sets/NA1/versions?platform=windows",
          sourceSha256: "a".repeat(64),
          observedAt: now.toISOString(),
        };
      },
      renderPackage: async () => {
        await Promise.resolve();
        return null;
      },
    });
  const originalDescriptor = await describePublicReplay(legacy, support);
  expect(originalDescriptor.playback).toMatchObject({
    status: "incompatible",
    reason: "unqualified_platform",
  });

  await backfillReplayMetadata(replayId, true);
  const descriptor = await describePublicReplay(repaired, support);
  expect(descriptor.matchId).toBe("NA1_123");
  expect(descriptor.playback).toEqual({
    status: "support_preparing",
    latestPatch: "16.21",
    reason: "render_package_unavailable",
  });
  mocks.find.mockResolvedValue(repaired);
  expect(await backfillReplayMetadata(replayId, true)).toEqual({
    replayId,
    outcome: "already_present",
  });
  expect(mocks.update).toHaveBeenCalledOnce();
});

test("known platform contradictions fail before reading or changing stored bytes", async () => {
  mocks.provenance.mockResolvedValue({
    localPuuid: "p".repeat(78),
    platformId: "EUW1",
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
  });
  await expect(backfillReplayMetadata(replayId, true)).rejects.toThrow(
    "platform",
  );
  expect(mocks.content).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

test.each([{ mapId: 12 }, { gameMode: "ARAM" }, { teamSizes: [4, 5] }])(
  "platform repair rejects contradictory stored presentation facts: %j",
  async (fact) => {
    mocks.find.mockResolvedValue({ ...row, ...fact, platformId: null });
    await expect(backfillReplayMetadata(replayId, true)).rejects.toThrow(
      "presentation metadata contradicts",
    );
    expect(mocks.content).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  },
);

test("platform repair preserves known facts when provenance cannot recover them", async () => {
  mocks.find.mockResolvedValue({
    ...row,
    platformId: null,
    mapId: 11,
    gameMode: "CLASSIC",
    teamSizes: [5, 5],
  });
  mocks.provenance.mockResolvedValue({
    localPuuid: "p".repeat(78),
    platformId: "NA1",
    mapId: null,
    gameMode: null,
    teamSizes: null,
  });
  await backfillReplayMetadata(replayId, true);
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: {
        ...metadata,
        platformId: "NA1",
      },
    }),
  );
});

test("a concurrent platform qualification cannot be overwritten", async () => {
  mocks.find.mockResolvedValue({ ...row, platformId: null });
  mocks.update.mockResolvedValue({ count: 0 });
  await expect(backfillReplayMetadata(replayId, true)).rejects.toThrow(
    "changed during validation",
  );
  expect(mocks.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ platformId: null }),
    }),
  );
});
