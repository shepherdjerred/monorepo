import { rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { currentSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { readLibraryHandoffReceipt } from "#infrastructure/handoff/library-receipt.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createPerEpisodeMultiSeasonFixture } from "./fixture.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture(1280);
  upgrade = await movieVideoFixture(1920, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("two real twelve-file approvals retain exact episode ownership and an approved household caption policy without a personal request", async () => {
  const f = await createPerEpisodeMultiSeasonFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
  expect(f.originalAssetIds).toHaveLength(24);
  expect(new Set(f.originalAssetIds).size).toBe(24);
  for (const receipt of f.receipts) {
    const actual = await readLibraryHandoffReceipt(
      f.db,
      receipt.receiptId,
      new PublicationAuthorityReadBudget(),
    );
    expect(actual.selection.scope.files).toHaveLength(12);
    const selectedEpisodes = actual.selection.scope.media.filter((item) =>
      f.ids.includes(item.mediaId),
    );
    expect(selectedEpisodes).toHaveLength(12);
    expect(selectedEpisodes.every((item) => item.monitored)).toBe(true);
  }
  const policies = await currentSubtitlePolicies(f.db, f.ids);
  expect(policies).toHaveLength(24);
  for (const policy of policies)
    expect(
      policy.rules.targets.map((target) => target.language).toSorted(),
    ).toEqual(["en", "zh-Hans"]);
  expect(
    await f.db.mediaRequest.count({
      where: { mediaId: { in: [f.series.id, ...f.ids] } },
    }),
  ).toBe(0);
  expect(
    await f.db.acquisitionAttempt.count({
      where: { mediaIds: { hasSome: f.ids } },
    }),
  ).toBe(0);
  const result = await f.acquired.reconcileMediaIntent(f.input);
  expect(result).toMatchObject({ status: "acquire" });
  const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: z.uuid().parse(result.attemptId) },
  });
  expect(attempt.mediaIds.toSorted()).toEqual(f.ids.toSorted());
  expect(attempt.sponsorRequestId).toBeNull();
  expect(f.wire.additions()).toBe(0);
}, 60_000);
