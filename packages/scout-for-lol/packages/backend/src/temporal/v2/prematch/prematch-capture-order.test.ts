import { afterEach, describe, expect, test, vi } from "vitest";
import { ArtifactDescriptorSchema } from "@scout-for-lol/domain/artifacts/descriptors.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { ScoutPrematchGameRefSchema } from "@scout-for-lol/temporal/contracts-v2";
import { rawCurrentGameInfoFixture } from "#src/testing/raw-capture-fixtures.ts";

/**
 * Which state the capture consults FIRST.
 *
 * This ordering is the whole correctness of a resumed run, and it is invisible
 * in the result: both orders return artifacts on the happy path. What differs
 * is the run that archived a snapshot and then died. Asking Riot first would
 * hear "that game is over" the moment it ended, report an empty capture, and
 * complete — stranding the lake projection and the notifications behind a
 * game-scoped Workflow ID that no later poll can reuse.
 */

const DESCRIPTOR = ArtifactDescriptorSchema.parse({
  kind: "prematch",
  key: "prematch/2026/09/13/9101/spectator-data.json",
  digest: "a".repeat(64),
  bytes: 1024,
  contentType: "application/json",
  capturedAt: "2026-09-13T00:00:00.000Z",
});

const mocks = vi.hoisted(() => ({
  resume: vi.fn(),
  live: vi.fn(),
  stage: vi.fn(),
  intents: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({ prisma: {} }));
vi.mock("#src/database/durable/receipt-repository.ts", () => ({
  listReceipts: () => Promise.resolve([]),
}));
vi.mock("#src/report-lake/paths.ts", () => ({
  resolveLakeDir: () => "/tmp/scout-lake-test",
}));
vi.mock("#src/report-lake/receipted-archive.ts", () => ({
  archivePrematchReceipted: () =>
    Promise.resolve({ status: "already_archived", artifact: DESCRIPTOR }),
}));
vi.mock("#src/report-lake/receipted-staging.ts", () => ({
  stagePrematchReceipted: mocks.stage,
}));
vi.mock("#src/temporal/v2/prematch/prematch-intents.ts", () => ({
  recordPrematchDeliveryIntentsV2: mocks.intents,
}));
vi.mock("#src/league/clash/sighting.ts", () => ({
  recordClashPrematchSightings: () => Promise.resolve(),
}));
vi.mock("#src/temporal/v2/prematch/prematch-resume.ts", () => ({
  resumeArchivedPrematchContext: mocks.resume,
}));
vi.mock("#src/temporal/v2/prematch/prematch-context.ts", () => ({
  resolveScoutV2PrematchContext: mocks.live,
}));

const { archivePrematchSnapshotV2 } =
  await import("#src/temporal/v2/prematch/prematch-archive.ts");

const GAME_REF = ScoutPrematchGameRefSchema.parse({
  puuid: "p".repeat(78),
  platform: "NA1",
  gameId: "9101",
});
const MATCH_ID = RiotMatchIdSchema.parse("NA1_9101");

function archivedContext() {
  return {
    riotMatchId: MATCH_ID,
    gameInfo: rawCurrentGameInfoFixture(),
    trackedPlayers: [],
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("the V2 prematch capture", () => {
  test("resumes from the archive without ever asking Riot", async () => {
    mocks.resume.mockResolvedValue(archivedContext());
    mocks.live.mockRejectedValue(
      new Error("the live spectator endpoint must not be consulted"),
    );
    mocks.stage.mockResolvedValue({ files: [], receipt: "recorded" });
    mocks.intents.mockResolvedValue({ minted: 2, existing: 0, conflicts: 0 });

    const result = await archivePrematchSnapshotV2({
      stage: "dev",
      gameRef: GAME_REF,
    });

    // The durable read answered, so the live one is not reached at all — which
    // is what lets this run finish after the game has ended.
    expect(mocks.live).not.toHaveBeenCalled();
    expect(mocks.stage).toHaveBeenCalledOnce();
    expect(mocks.intents).toHaveBeenCalledOnce();
    expect(result.riotMatchId).toBe(MATCH_ID);
    expect(result.artifacts.map((artifact) => artifact.receipt.kind)).toEqual([
      "raw-archive-prematch",
      "lake-staging-prematch",
    ]);
  });

  test("falls through to the live read only when nothing was archived", async () => {
    mocks.resume.mockResolvedValue(null);
    mocks.live.mockResolvedValue(null);

    const result = await archivePrematchSnapshotV2({
      stage: "dev",
      gameRef: GAME_REF,
    });

    // Nothing archived and Riot confirms no game: the snapshot was genuinely
    // missed, and a no-op is the honest answer. This is the ONLY path on which
    // a live absence is allowed to end the run.
    expect(mocks.resume).toHaveBeenCalledOnce();
    expect(mocks.live).toHaveBeenCalledOnce();
    expect(result.artifacts).toEqual([]);
    expect(mocks.intents).not.toHaveBeenCalled();
  });
});
