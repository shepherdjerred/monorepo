import { rm } from "node:fs/promises";
import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  stagedPerEpisodePublicationFixture,
  sealPerEpisodePublicationFixture,
  seriesPackPublicationEffectHashes,
} from "#testing/series-workflow/per-episode/publication-fixture.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { publicationDeadline } from "#automation/publication-proof/invocation.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { SeriesPackPublicationPreparationPayloadV1Schema } from "#shared/acquisition/series-pack-publication-v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { providedAllowance } from "#testing/series-workflow/per-episode/publication-acceptance.ts";

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
async function staged() {
  return stagedPerEpisodePublicationFixture(
    h.database(),
    (directory) => directories.push(directory),
    { original, upgrade },
  );
}

test("all six actual bounded facets protect the original99-spent allowance before any new native publication effect", async () => {
  const f = await sealPerEpisodePublicationFixture(await staged());
  const execution = testPublicationExecution;
  const work = [
    (budget: PublicationAuthorityReadBudget) =>
      f.facet.prepareSeriesPackMembersPublicationV1(
        { ...f.input, batchIndex: 0 },
        execution(),
        budget,
      ),
    (budget: PublicationAuthorityReadBudget) =>
      f.facet.sealSeriesPackPublicationIntentV1(f.input, execution(), budget),
    (budget: PublicationAuthorityReadBudget) =>
      f.facet.publishSeriesPackMembersV1(
        { ...f.input, batchIndex: 0 },
        execution(),
        budget,
      ),
    (budget: PublicationAuthorityReadBudget) =>
      f.facet.sealSeriesPackPublicationOutcomeV1(f.input, execution(), budget),
    (budget: PublicationAuthorityReadBudget) =>
      f.facet.compensateSeriesPackMembersV1(
        { ...f.input, batchIndex: 0 },
        execution(),
        budget,
      ),
    (budget: PublicationAuthorityReadBudget) =>
      f.facet.sealSeriesPackCompensationV1(f.input, execution(), budget),
  ];
  for (const effect of work) {
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    expect(await effect(budget)).toMatchObject({
      status: "blocked",
      reason: "archive_transition_reconciliation_required",
    });
    expect(() => budget.consume(1)).toThrow("100 total queried records");
  }
  expect(await seriesPackPublicationEffectHashes(f)).toEqual([]);
  expect(
    await f.f.db.operation.count({
      where: {
        targetId: f.input.attemptId,
        kind: "publish_series_pack_members_v1",
      },
    }),
  ).toBe(0);
}, 60_000);

test("raw SQL rejects mutated, foreign and incomplete genuine preparation parents without granting a whole publication", async () => {
  const f = await staged();
  expect(
    await providedAllowance((budget) =>
      f.facet.prepareSeriesPackMembersPublicationV1(
        { ...f.input, batchIndex: 0 },
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toMatchObject({ status: "prepared" });
  const parent = await f.f.db.operation.findFirstOrThrow({
    where: {
      targetId: f.input.attemptId,
      kind: "prepare_series_pack_publication_v1",
    },
  });
  const originalHash = identityHash(nativeJson(parent));
  await expect(
    f.f.db.operation.update({
      where: { id: parent.id },
      data: { payload: { forged: true } },
    }),
  ).rejects.toThrow("immutable");
  await expect(
    f.f.db.operation.delete({ where: { id: parent.id } }),
  ).rejects.toThrow("immutable");
  const payload = SeriesPackPublicationPreparationPayloadV1Schema.parse(
    parent.payload,
  );
  if (parent.idempotencyKey === null)
    throw new Error("Actual prepared parent lost its literal idempotency key");
  const idempotencyKey = parent.idempotencyKey;
  const prepared = {
    ...payload.prepared,
    scope: { ...payload.prepared.scope, filePlanHash: "0".repeat(64) },
  };
  const forged = {
    ...payload,
    prepared,
    preparedHash: identityHash(prepared),
    raw: canonicalJson(z.json().parse(prepared)),
    scopeRaw: canonicalJson(z.json().parse(prepared.scope)),
  };
  const sdk = testPublicationExecution();
  await expect(
    f.f.db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(
        tx,
        publicationDeadline(sdk, sdk.expiresAtMs),
      );
      await tx.operation.create({
        data: {
          kind: parent.kind,
          targetId: parent.targetId,
          userId: null,
          status: "completed",
          idempotencyKey: `${idempotencyKey}:forged`,
          payload: z.record(z.string(), z.json()).parse(forged),
        },
      });
    }),
  ).rejects.toThrow("actual complete immutable staging seal");
  await expect(
    f.facet.sealSeriesPackPublicationIntentV1(
      f.input,
      testPublicationExecution(),
      new PublicationAuthorityReadBudget(),
    ),
  ).rejects.toThrow("incomplete or foreign");
  expect(
    await f.f.db.mediaPublicationTransition.count({
      where: { attemptId: f.input.attemptId },
    }),
  ).toBe(0);
  expect(
    identityHash(
      nativeJson(
        await f.f.db.operation.findUniqueOrThrow({ where: { id: parent.id } }),
      ),
    ),
  ).toBe(originalHash);
  expect(await seriesPackPublicationEffectHashes(f)).toEqual([]);
}, 60_000);

test("a foreign coordinator and missing physical partition never grant the original whole-plan outcome", async () => {
  const f = await sealPerEpisodePublicationFixture(await staged());
  const foreign = { ...f.input, operationId: crypto.randomUUID() };
  expect(
    await f.facet.publishSeriesPackMembersV1(
      { ...foreign, batchIndex: 0 },
      testPublicationExecution(),
      new PublicationAuthorityReadBudget(),
    ),
  ).toEqual({ status: "obsolete", reason: "acquisition_obsolete" });
  expect(
    await f.facet.sealSeriesPackPublicationOutcomeV1(
      foreign,
      testPublicationExecution(),
      new PublicationAuthorityReadBudget(),
    ),
  ).toEqual({ status: "obsolete", reason: "acquisition_obsolete" });
  expect(
    await providedAllowance((budget) =>
      f.facet.sealSeriesPackPublicationOutcomeV1(
        f.input,
        testPublicationExecution(),
        budget,
      ),
    ),
  ).toEqual({
    status: "blocked",
    reason: "series_pack_publication_effects_incomplete",
  });
  expect(await seriesPackPublicationEffectHashes(f)).toEqual([]);
  expect(
    await f.f.db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.input.attemptId },
    }),
  ).toMatchObject({ outcome: null, outcomeHash: null });
}, 60_000);
