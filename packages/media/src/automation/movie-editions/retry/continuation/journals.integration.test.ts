import { expect, test } from "vitest";
import { z } from "zod";
import { createHash } from "node:crypto";
import { MovieRetryRenewalEnvelopeV2Schema } from "#shared/movie-editions/retry/v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  continuationHarness,
  attemptInput,
  finishContinuation,
  literalBirth,
} from "./support.ts";

const h = continuationHarness();
test.each([false, true])(
  "an actual pending intent survives two genuine continuations and retains its literal original snapshot (upgrade=%s)",
  async (upgrade) => {
    const f = await h.fixture("extended_cut", "intent", { upgrade });
    const before = await f.evidence();
    if (
      before.attempt === null ||
      before.plan === null ||
      before.publication === null
    )
      throw new Error("Actual durable publication intent missing");
    expect(before.publication.outcome).toBeNull();
    const attemptId = before.attempt.id;
    if (upgrade)
      expect(before.plan.entries[0].previousSidecars).toHaveLength(2);
    const physical = await f.fileEvidence();
    const first = await f.retry();
    expect(
      await f.movie.reconcileMovieIntentV4(
        first.input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "acquire", attemptId: before.attempt.id });
    f.enableFailure("intent");
    await expect(
      f.fileMovie.promoteMovieFilesV4(
        await attemptInput(f, first.input.operationId),
        testPublicationExecution(),
      ),
    ).rejects.toThrow(
      "Synthetic committed movie intent dependency unavailable",
    );
    f.allowRecovery();
    await f.finishMediaOperation({
      operationId: first.input.operationId,
      status: "reconciling",
      reason: "movie_operation_failed",
    });
    const paused = await f.evidence();
    expect(paused.publication).toEqual(before.publication);
    expect(paused.attempt?.filePlan).toEqual(before.attempt.filePlan);
    f.useDescriptions((id) => {
      if (
        id !== `media-operation-${first.input.operationId}` &&
        id !== `media-acquire-${attemptId}`
      )
        throw new Error(
          "Second continuation inspected an unrelated predecessor",
        );
      return Promise.resolve({
        status: "FAILED",
        runId: `synthetic-second-terminal:${id}`,
      });
    });
    const second = await f.retry();
    expect(
      await f.movie.reconcileMovieIntentV4(
        second.input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "acquire", attemptId: before.attempt.id });
    const renewed = await f.db.operation.findUniqueOrThrow({
      where: { id: second.input.operationId },
    });
    const receipt = MovieRetryRenewalEnvelopeV2Schema.parse(
      z.object({ movieRetryRenewalV2: z.json() }).parse(renewed.result)
        .movieRetryRenewalV2,
    ).receipt;
    expect(receipt.capture.previousCoordinatorOperationId).toBe(
      first.input.operationId,
    );
    expect(receipt.capture.continuation.publication?.attemptSnapshotHash).toBe(
      z
        .object({ attemptSnapshotHash: z.string() })
        .parse(before.publication.intent).attemptSnapshotHash,
    );
    const completed = await finishContinuation(f, second.input.operationId);
    expect(completed.attempt?.filePlan).toEqual(before.attempt.filePlan);
    if (completed.attempt === null)
      throw new Error("Actual completed acquisition missing");
    expect(literalBirth(completed.attempt)).toEqual(
      literalBirth(before.attempt),
    );
    expect(completed.publication?.id).toBe(before.publication.id);
    expect(completed.publication?.intent).toEqual(before.publication.intent);
    expect(completed.publication?.intentHash).toBe(
      before.publication.intentHash,
    );
    expect(completed.publication?.outcomeHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(completed.adds).toBe(1);
    expect(completed.torrentCount).toBe(before.torrentCount);
    const journals = await f.journalEvidence();
    expect(journals).toHaveLength(upgrade ? 3 : 1);
    for (const journal of journals) {
      const actual = z
        .object({
          operationId: z.literal(journal.id),
          phase: z.literal("complete"),
        })
        .parse(JSON.parse(z.string().parse(journal.literal)));
      expect(actual.operationId).toBe(journal.id);
    }
    const files = await f.fileEvidence();
    expect(
      files.some(
        (file) =>
          file.sha256 ===
          createHash("sha256")
            .update(upgrade ? h.upgrade : h.bytes)
            .digest("hex"),
      ),
    ).toBe(true);
    for (const original of physical)
      expect(
        files.some(
          (file) =>
            file.sha256 === original.sha256 && file.size === original.size,
        ),
      ).toBe(true);
    expect(identityHash(completed.attempt.filePlan)).toBe(
      identityHash(before.attempt.filePlan),
    );
  },
  60_000,
);

test("a genuine approved household imported continuation retains its actual policy and creates no personal consent", async () => {
  const f = await h.fixture("directors_cut", "imported", {
    upgrade: true,
    managed: true,
  });
  const before = await f.evidence();
  if (before.attempt === null || f.managementReceiptId === null)
    throw new Error("Actual approved household continuation missing");
  const policy = await f.db.mediaHandoffReceipt.findUniqueOrThrow({
    where: { id: f.managementReceiptId },
  });
  expect(before.requests).toEqual([]);
  expect(before.choices).toEqual([]);
  expect(before.attempt).toMatchObject({
    sponsorRequestId: null,
    movieEditionChoiceId: null,
    identityEvidence: { schemaVersion: 3 },
  });
  const queued = await f.retry(true);
  expect(
    await f.movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "acquire", attemptId: before.attempt.id });
  const completed = await finishContinuation(f, queued.input.operationId, true);
  expect(completed.publication).toEqual(before.publication);
  expect(completed.choices).toEqual([]);
  expect(completed.requests).toEqual([]);
  expect(completed.adds).toBe(1);
  expect(completed.torrentCount).toBe(1);
  expect(
    await f.db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: f.managementReceiptId },
    }),
  ).toEqual(policy);
}, 60_000);
