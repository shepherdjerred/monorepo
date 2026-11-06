import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { z } from "zod";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import {
  MovieRetryCaptureV2Schema,
  MovieRetryRenewalEnvelopeV2Schema,
} from "#shared/movie-editions/retry/v2.ts";
import { MoviePublicationIntentV2Schema } from "#shared/movie-editions/publication-v2.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeAttempt } from "#infrastructure/native-recovery/snapshots.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { continuationHarness, literalBirth, attemptInput } from "./support.ts";

const h = continuationHarness();
for (const phase of ["prepared", "imported"] as const) {
  test.each(MovieEditionKeySchema.options)(
    `%s continues its actual ${phase} acquisition through the same literal plan and original transfer`,
    async (edition) => {
      const f = await h.fixture(edition, phase);
      const before = await f.evidence();
      if (before.attempt === null || before.plan === null)
        throw new Error("Actual prepared plan missing");
      const journals = await f.journalEvidence();
      const physical = await f.fileEvidence();
      if (phase === "imported") f.forbidLiveTransfer();
      const queued = await f.retry();
      const capture = z
        .object({ movieRetryV2: MovieRetryCaptureV2Schema })
        .parse(queued.operation.payload).movieRetryV2;
      expect(capture.continuation).toMatchObject({
        phase,
        filePlanHash: identityHash(before.attempt.filePlan),
        beforeAttemptHash: identityHash(nativeAttempt(before.attempt)),
      });
      expect(capture.previousCoordinatorOperationId).toBe(
        before.attempt.coordinatorOperationId,
      );
      expect(queued.input.generation).toBe(f.input.generation);
      expect(
        await f.movie.reconcileMovieIntentV4(
          queued.input,
          testPlexBindingExecution(),
        ),
      ).toMatchObject({ status: "acquire", attemptId: before.attempt.id });
      const renewed = await f.evidence();
      if (renewed.attempt === null)
        throw new Error("Renewed actual acquisition missing");
      expect(literalBirth(renewed.attempt)).toEqual(
        literalBirth(before.attempt),
      );
      expect(renewed.attempt.filePlan).toEqual(before.attempt.filePlan);
      expect(renewed.attempt.coordinatorOperationId).toBe(
        queued.input.operationId,
      );
      expect(renewed.choices).toEqual(before.choices);
      expect(renewed.requests).toEqual(before.requests);
      const stored = await f.db.operation.findUniqueOrThrow({
        where: { id: queued.input.operationId },
      });
      const receipt = MovieRetryRenewalEnvelopeV2Schema.parse(
        z.object({ movieRetryRenewalV2: z.json() }).parse(stored.result)
          .movieRetryRenewalV2,
      );
      expect(receipt.receipt.beforeAttempt).toEqual(
        nativeAttempt(before.attempt),
      );
      expect(receipt.receiptHash).toBe(identityHash(receipt.receipt));
      const input = await attemptInput(f, queued.input.operationId);
      expect(
        await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
      ).toMatchObject({ status: "submitted" });
      expect(
        await f.movie.observeMovieAcquisitionV4(
          input,
          testPlexBindingExecution(),
        ),
      ).toEqual({
        status: "ready",
        reason: phase === "imported" ? "resume_committed_publication" : null,
      });
      if (phase === "prepared") {
        expect(
          await f.fileMovie.inspectAndStageMovieV4(
            input,
            testPublicationExecution(),
          ),
        ).toEqual({ status: "staged" });
        expect(await f.journalEvidence()).toEqual(journals);
        expect(
          await f.fileMovie.promoteMovieFilesV4(
            input,
            testPublicationExecution(),
          ),
        ).toEqual({ status: "published" });
      }
      const checkpointCount = f.control.physicalCheckpoints.length;
      expect(
        await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
      ).toEqual({ status: "available", reason: null });
      await f.movie.finalizeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      );
      const completed = await f.evidence();
      expect(completed.attempt).toMatchObject({
        id: before.attempt.id,
        state: "completed",
        coordinatorOperationId: queued.input.operationId,
        filePlan: before.attempt.filePlan,
        torrentId: before.attempt.torrentId,
      });
      expect(completed.adds).toBe(1);
      expect(completed.torrentCount).toBe(before.torrentCount);
      expect(completed.assets).toHaveLength(1);
      expect(completed.target.generation).toBe(before.target.generation);
      expect(f.control.physicalCheckpoints).toHaveLength(checkpointCount);
      const files = await f.fileEvidence();
      expect(files).toEqual([
        {
          path: completed.assets[0]?.path,
          size: h.bytes.byteLength,
          sha256: createHash("sha256").update(h.bytes).digest("hex"),
        },
      ]);
      const plex = await readMoviePlexReceiptV2(
        f.db,
        input,
        new PublicationAuthorityReadBudget(),
      );
      expect(plex).toMatchObject({
        input,
        publication: {
          transitionId: completed.publication?.id,
          intentHash: completed.publication?.intentHash,
          outcomeHash: completed.publication?.outcomeHash,
        },
      });
      if (phase === "imported") {
        expect(completed.publication).toEqual(before.publication);
        expect(await f.journalEvidence()).toEqual(journals);
        expect(files).toEqual(physical);
      } else {
        const intent = MoviePublicationIntentV2Schema.parse(
          completed.publication?.intent,
        );
        expect(intent.attemptSnapshotHash).toBe(
          identityHash(nativeAttempt(renewed.attempt)),
        );
      }
    },
    60_000,
  );
}
