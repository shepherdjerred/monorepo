import { expect, vi } from "vitest";
import type { createPerEpisodeMultiSeasonFixture } from "./fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  readCurrentPlexBindings,
  readLegacyDefaultPlexDisplay,
} from "#infrastructure/plex-binding/read.ts";
import { currentSubtitleWork } from "#automation/subtitles/authority.ts";
import { queueCurrentSubtitleTargets } from "#automation/subtitles/queue.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";

type Fixture = Awaited<ReturnType<typeof createPerEpisodeMultiSeasonFixture>>;

/** Observe the real allowance; never replace its admission or reset it. */
export async function originalAllowance<T>(
  work: (budget: PublicationAuthorityReadBudget) => Promise<T>,
  supplied = false,
) {
  const budget = new PublicationAuthorityReadBudget();
  const consume = vi.spyOn(PublicationAuthorityReadBudget.prototype, "consume");
  try {
    const result = await work(budget);
    expect(consume.mock.calls.length).toBeGreaterThan(0);
    expect(new Set(consume.mock.contexts).size).toBe(1);
    if (supplied) expect(consume.mock.contexts[0]).toBe(budget);
    expect(
      consume.mock.calls.reduce((sum, [count]) => sum + count, 0),
    ).toBeLessThanOrEqual(100);
    return result;
  } finally {
    consume.mockRestore();
  }
}

export function providedAllowance<T>(
  work: (budget: PublicationAuthorityReadBudget) => Promise<T>,
) {
  return originalAllowance(work, true);
}

export async function completeMemberBatches(
  expected: "staged" | "prepared" | "published",
  work: (
    batchIndex: number,
  ) => Promise<{ status: string; nextBatchIndex?: number | null }>,
) {
  let batchIndex: number | null = 0;
  let completed = 0;
  while (batchIndex !== null) {
    const result = await work(batchIndex);
    expect(result, JSON.stringify(result)).toMatchObject({ status: expected });
    if (result.nextBatchIndex === undefined)
      throw new Error("Actual member batch omitted its next cursor");
    batchIndex = result.nextBatchIndex;
    completed++;
    expect(completed).toBeLessThanOrEqual(6);
  }
  expect(completed).toBe(6);
}

/** Old database rows remain unchanged while their physical paths are in transition. */
export async function assertWholePackPending(f: Fixture, attemptId: string) {
  const coverage = await f.db.assetCoverage.findMany({
    where: { mediaId: { in: f.ids }, edition: "default", current: true },
  });
  expect(new Set(coverage.map((row) => row.assetId))).toEqual(
    new Set(f.originalAssetIds),
  );
  const inputs = coverage.map((row) => ({
    scope: { mediaId: row.mediaId, edition: "default" as const },
    assetId: row.assetId,
    access: {
      serverMachineId: "fixture-server",
      sectionId: "2",
      sectionType: "show" as const,
    },
  }));
  expect(await readCurrentPlexBindings(f.db, inputs)).toEqual(
    inputs.map(() => ({
      status: "protected",
      reason: "series_pack_publication_pending",
    })),
  );
  const first = inputs[0];
  if (first === undefined)
    throw new Error("Actual whole pack lost its original coverage");
  expect(await readLegacyDefaultPlexDisplay(f.db, first)).toEqual({
    status: "protected",
    reason: "series_pack_publication_pending",
  });
  const work = await currentSubtitleWork(f.db, first.assetId, 0);
  expect(work.protectedReasons).toContain("series_pack_publication_pending");
  expect(
    await f.db.$transaction((tx) =>
      queueCurrentSubtitleTargets(tx, { assetId: first.assetId, epoch: 0 }),
    ),
  ).toBe(0);
  await expect(
    f.db.$transaction((tx) =>
      assertNoPublicationCompensationFence(tx, { mediaIds: f.ids }),
    ),
  ).rejects.toMatchObject({ code: "series_pack_publication_pending" });
  await expect(
    f.db.$transaction((tx) =>
      assertNoPublicationCompensationFence(tx, {
        mediaIds: [first.scope.mediaId],
        seriesPackPublicationAttemptId: attemptId,
      }),
    ),
  ).rejects.toMatchObject({ code: "series_pack_publication_pending" });
  await f.db.$transaction((tx) =>
    assertNoPublicationCompensationFence(tx, {
      mediaIds: f.ids,
      seriesPackPublicationAttemptId: attemptId,
    }),
  );
}
