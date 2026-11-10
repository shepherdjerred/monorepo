import { createHash } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, beforeAll, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  stagedPerEpisodePublicationFixture,
  commitPerEpisodePublicationFixture,
} from "#testing/series-workflow/per-episode/publication-fixture.ts";
import {
  originalAllowance,
  providedAllowance,
} from "#testing/series-workflow/per-episode/publication-acceptance.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { sha256File } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readCurrentPlexBindings } from "#infrastructure/plex-binding/read.ts";
import { readPlexPhysicalGroup } from "#infrastructure/plex-binding/read.ts";
import { seriesPackLibraryRollbackOriginsV1 } from "#infrastructure/acquisition-identity/series-pack/publication/rollback-origin.ts";
import { loadSeriesPackPublicationRecordV1 } from "#infrastructure/acquisition-identity/series-pack/publication/store.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
let published: Awaited<ReturnType<typeof imported>> | undefined;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  const owned = directories.splice(0);
  try {
    // Each case owns different physical roots. Dispose only its exact unreviewed
    // synthetic rows before removing those roots; the next actual file fixture
    // creates its own fresh authority with the original 120-second lifetime.
    const rows = await h.database().mediaStorageAuthority.findMany({
      where: { rootPath: { in: ["/data/movies", "/data/tv"] } },
    });
    for (const row of rows) {
      if (
        !z
          .strictObject({ source: z.literal("synthetic-file-fixture") })
          .safeParse(row.evidence).success
      )
        continue;
      const role = row.rootPath === "/data/movies" ? "movies" : "tv";
      if (
        row.recoveryEpoch !== 0 ||
        row.pvcUid !== `synthetic-${role}` ||
        row.volumeName !== `synthetic-${role}` ||
        row.workerPodUid !== "synthetic-files-worker" ||
        row.revokedAt !== null ||
        !owned.some(
          (directory) => row.volumePath === path.join(directory, "library"),
        )
      )
        throw new Error(
          "Owned synthetic storage tuple changed before fixture disposal",
        );
      const deleted = await h.database().mediaStorageAuthority.deleteMany({
        where: {
          rootPath: row.rootPath,
          version: row.version,
          recoveryEpoch: row.recoveryEpoch,
          pvcUid: row.pvcUid,
          volumeName: row.volumeName,
          volumePath: row.volumePath,
          workerPodUid: row.workerPodUid,
          revokedAt: row.revokedAt,
          observedAt: row.observedAt,
          expiresAt: row.expiresAt,
          evidence: { equals: { source: "synthetic-file-fixture" } },
        },
      });
      expect(deleted.count).toBe(1);
    }
  } finally {
    for (const directory of owned)
      await rm(directory, { recursive: true, force: true });
  }
});
async function imported() {
  await h.context().refreshWriterLease();
  return commitPerEpisodePublicationFixture(
    await stagedPerEpisodePublicationFixture(
      h.database(),
      (directory) => directories.push(directory),
      { original, upgrade },
    ),
  );
}

// Keep genuine import/publication prerequisites under their own original 60s
// setup bound. Each rollback assertion retains 60s and uses these exact rows,
// files, authority timestamps and allowances without refreshing them.
beforeEach(async () => {
  published = undefined;
  published = await imported();
}, 60_000);

function preparedPublication() {
  if (published === undefined)
    throw new Error("Genuine published-pack prerequisite did not complete");
  return published;
}

test("actual failed Plex verification rolls twenty-four committed upgrades back and rebinds both genuine initial-library seasons", async () => {
  const f = preparedPublication();
  const before = await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: f.input.attemptId },
  });
  const beforeHash = identityHash(nativeJson(before));
  f.f.wire.control.rejectPublishedPlex = true;
  expect(
    await originalAllowance(() => f.f.publication.publishMediaToPlex(f.input)),
  ).toMatchObject({ status: "blocked" });
  expect(
    await providedAllowance((budget) =>
      f.facet.rollbackPublishedSeriesPackV1(
        f.input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "rolled_back" });
  const expected = createHash("sha256").update(original).digest("hex");
  const restored = await f.f.db.libraryAsset.findMany({
    where: { id: { in: f.f.originalAssetIds } },
    orderBy: { id: "asc" },
  });
  expect(restored).toHaveLength(24);
  for (const asset of restored) {
    expect(asset).toMatchObject({
      state: "published",
      checksum: expected,
      version: 2,
      torrentId: null,
    });
    expect(await sha256File(workerFilePath(f.f.files, asset.path))).toBe(
      expected,
    );
  }
  const lineageBudget = new PublicationAuthorityReadBudget();
  const rolledBackAttempt = await f.f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.input.attemptId },
  });
  const origin = await seriesPackLibraryRollbackOriginsV1(
    f.f.db,
    { identity: rolledBackAttempt.identityEvidence, epoch: 0 },
    lineageBudget,
  );
  const actualParent = await loadSeriesPackPublicationRecordV1(
    f.f.db,
    f.input.attemptId,
    lineageBudget,
  );
  if (origin === null || actualParent === null)
    throw new Error(
      "Actual committed library rollback lost its original parent",
    );
  for (const asset of restored) {
    const current = await readPlexPhysicalGroup(f.f.db, asset.id);
    const recorded = actualParent.reference.intent.entries.find(
      (item) => item.entry.previousAssetId === asset.id,
    );
    expect(origin(current.group, recorded?.predecessor ?? null)).toBe(true);
  }
  expect(
    await originalAllowance(() =>
      f.f.publication.publishRolledBackMedia(f.input),
    ),
  ).toEqual({ status: "available", reason: null });
  const reads = await readCurrentPlexBindings(
    f.f.db,
    f.plan.flatMap((entry) => {
      const assetId = entry.previousAssetId;
      if (assetId === null) return [];
      return entry.mediaIds.map((mediaId) => ({
        scope: { mediaId, edition: "default" as const },
        assetId,
        access: {
          serverMachineId: "fixture-server",
          sectionId: "2",
          sectionType: "show" as const,
        },
      }));
    }),
  );
  expect(reads).toHaveLength(24);
  expect(reads.every((row) => row.status === "current")).toBe(true);
  expect(
    await f.f.db.acquisitionReservation.count({
      where: { attemptId: f.input.attemptId },
    }),
  ).toBe(0);
  expect(
    await f.f.db.libraryAsset.count({
      where: {
        id: { in: f.plan.map((entry) => entry.assetId) },
        state: "rejected",
        version: 1,
      },
    }),
  ).toBe(24);
  expect(
    identityHash(
      nativeJson(
        await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
          where: { attemptId: f.input.attemptId },
        }),
      ),
    ),
  ).toBe(beforeHash);
  expect(
    await providedAllowance((budget) =>
      f.facet.rollbackPublishedSeriesPackV1(
        f.input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "rolled_back" });
  expect(f.f.wire.additions()).toBe(1);
}, 60_000);

test("already served packs and exhausted original allowances cannot initiate the failed-Plex rollback path", async () => {
  const f = preparedPublication();
  expect(
    await originalAllowance(() => f.f.publication.publishMediaToPlex(f.input)),
  ).toEqual({ status: "available", reason: null });
  const before = await f.f.db.libraryAsset.findMany({
    where: { id: { in: f.plan.map((entry) => entry.assetId) } },
    orderBy: { id: "asc" },
  });
  expect(
    await providedAllowance((budget) =>
      f.facet.rollbackPublishedSeriesPackV1(
        f.input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "protected", reason: "series_pack_already_served" });
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  expect(
    await f.facet.rollbackPublishedSeriesPackV1(
      f.input,
      testPublicationExecution(),
      budget,
    ),
  ).toMatchObject({
    status: "protected",
    reason: "archive_transition_reconciliation_required",
  });
  expect(
    await f.f.db.libraryAsset.findMany({
      where: { id: { in: f.plan.map((entry) => entry.assetId) } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(before);
}, 60_000);

test("generation revocation cannot be converted into fresh post-import repair consent", async () => {
  const f = preparedPublication();
  const last = f.f.ids.at(-1);
  if (last === undefined)
    throw new Error("Actual original scope lost its final leaf");
  await f.f.db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: last, edition: "default" } },
    data: { generation: { increment: 1 } },
  });
  expect(
    await providedAllowance((budget) =>
      f.facet.rollbackPublishedSeriesPackV1(
        f.input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({ status: "obsolete", reason: "intent_obsolete" });
  expect(
    await f.f.db.libraryAsset.count({
      where: {
        id: { in: f.plan.map((entry) => entry.assetId) },
        state: "published",
        version: 0,
      },
    }),
  ).toBe(24);
}, 60_000);

test.each(["predecessor", "successor"] as const)(
  "actual %s version drift protects every committed file before rollback effects",
  async (changed) => {
    const f = preparedPublication();
    const entry = f.plan.at(-1);
    if (entry?.previousAssetId == null)
      throw new Error(
        "Actual committed upgrade omitted its original predecessor",
      );
    await f.f.db.libraryAsset.update({
      where: {
        id: changed === "predecessor" ? entry.previousAssetId : entry.assetId,
      },
      data: { version: { increment: 1 } },
    });
    const assets = await f.f.db.libraryAsset.findMany({
      where: {
        id: {
          in: f.plan.flatMap((item) =>
            item.previousAssetId === null
              ? [item.assetId]
              : [item.assetId, item.previousAssetId],
          ),
        },
      },
      orderBy: { id: "asc" },
    });
    const before = await Promise.all(
      assets.map((asset) => sha256File(workerFilePath(f.f.files, asset.path))),
    );
    expect(
      await providedAllowance((budget) =>
        f.facet.rollbackPublishedSeriesPackV1(
          f.input,
          testPublicationExecution(),
          budget,
        ),
      ),
    ).toEqual({ status: "protected", reason: "rollback_asset_changed" });
    expect(
      await f.f.db.libraryAsset.findMany({
        where: { id: { in: assets.map((asset) => asset.id) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(assets);
    expect(
      await Promise.all(
        assets.map((asset) =>
          sha256File(workerFilePath(f.f.files, asset.path)),
        ),
      ),
    ).toEqual(before);
    expect(
      await f.f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.input.attemptId },
      }),
    ).toMatchObject({ state: "imported" });
  },
  60_000,
);
