import { expect, test } from "vitest";
import { z } from "zod";
import { MovieRetryRenewalEnvelopeV2Schema } from "#shared/movie-editions/retry/v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeAttempt } from "#infrastructure/native-recovery/snapshots.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { continuationHarness } from "./support.ts";

const h = continuationHarness();
test.each(["prepared", "imported"] as const)(
  "SQL binds %s coordinator renewal to its actual before snapshot and immutable same-transaction proof",
  async (phase) => {
    const f = await h.fixture("unrated_cut", phase);
    const queued = await f.retry();
    const before = await f.evidence();
    if (before.attempt === null)
      throw new Error("Actual SQL continuation acquisition missing");
    const execution = testPlexBindingExecution();
    const freshness = plexBindingFreshness({
      observed: execution.observed,
      expiresAtMs: execution.expiresAtMs,
      guards: [execution],
    });
    await expect(
      f.db.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness);
        await tx.$executeRaw`UPDATE "AcquisitionAttempt" SET "coordinatorOperationId"=${queued.input.operationId} WHERE id=${before.attempt?.id}`;
      }),
    ).rejects.toThrow(
      "same-transaction native before snapshot and immutable renewal",
    );
    expect(await f.evidence()).toEqual(before);
    await expect(
      f.db.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness);
        await tx.$executeRaw`UPDATE "Operation" SET payload=jsonb_set(payload,'{movieRetryV2,continuation,filePlanHash}',to_jsonb(repeat('0',64))) WHERE id=${queued.input.operationId}`;
      }),
    ).rejects.toThrow("Movie continuation original selection is immutable");
    expect(
      await f.movie.reconcileMovieIntentV4(
        queued.input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "acquire", attemptId: before.attempt.id });
    const stored = await f.db.operation.findUniqueOrThrow({
      where: { id: queued.input.operationId },
    });
    const envelope = MovieRetryRenewalEnvelopeV2Schema.parse(
      z.object({ movieRetryRenewalV2: z.json() }).parse(stored.result)
        .movieRetryRenewalV2,
    );
    expect(envelope.receipt.beforeAttempt).toEqual(
      nativeAttempt(before.attempt),
    );
    expect(envelope.receiptHash).toBe(identityHash(envelope.receipt));
    await expect(
      f.db.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness);
        await tx.$executeRaw`UPDATE "Operation" SET result=result-'movieRetryRenewalV2' WHERE id=${queued.input.operationId}`;
      }),
    ).rejects.toThrow("Movie continuation proof is immutable");
    await expect(
      f.db.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness);
        await tx.$executeRaw`UPDATE "Operation" SET result=jsonb_set(result,'{movieRetryRenewalV2,receipt,beforeAttempt,coordinatorOperationId}',to_jsonb(${queued.input.operationId}::text)) WHERE id=${queued.input.operationId}`;
      }),
    ).rejects.toThrow("Movie continuation proof is immutable");
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: queued.input.operationId },
      }),
    ).toEqual(stored);
  },
  60_000,
);
