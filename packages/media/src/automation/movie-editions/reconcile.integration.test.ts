import { expect, test } from "vitest";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";

test.each(MovieEditionKeySchema.options)(
  "the actual %s coordinator creates and completes its scoped acquisition from consent through Plex",
  async (edition) => {
    const f = await createMovieWorkflowFixture(edition);
    try {
      const initial = await f.evidence();
      expect(initial.attempts).toEqual([]);
      const reconciled = await f.movie.reconcileMovieIntentV4(
        f.input,
        testPlexBindingExecution(),
      );
      expect(reconciled.status).toBe("acquire");
      if (reconciled.attemptId === null)
        throw new Error("Real coordinator omitted its acquisition");
      const attempt = {
        schemaVersion: 4 as const,
        operationId: f.input.operationId,
        attemptId: reconciled.attemptId,
        scope: f.input.scope,
      };
      expect(
        await f.movie.submitMovieTorrentV4(attempt, testPlexBindingExecution()),
      ).toEqual({ status: "submitted", reason: null });
      expect(
        await f.movie.observeMovieAcquisitionV4(
          attempt,
          testPlexBindingExecution(),
        ),
      ).toEqual({ status: "ready", reason: null });
      expect(
        await f.fileMovie.inspectAndStageMovieV4(
          attempt,
          testPublicationExecution(),
        ),
      ).toEqual({ status: "staged" });
      expect(
        await f.fileMovie.promoteMovieFilesV4(
          attempt,
          testPublicationExecution(),
        ),
      ).toEqual({ status: "published" });
      expect(
        await f.movie.publishMovieToPlexV4(attempt, testPlexBindingExecution()),
      ).toEqual({ status: "available", reason: null });
      await f.movie.finalizeMovieAcquisitionV4(
        attempt,
        testPlexBindingExecution(),
      );
      const evidence = await f.evidence();
      expect(evidence.attempts).toHaveLength(1);
      expect(evidence.attempts[0]).toMatchObject({
        state: "completed",
        edition,
        reservations: [],
        torrent: { owned: true },
      });
      expect(evidence.assets).toHaveLength(1);
      expect(evidence.assets[0]).toMatchObject({
        state: "published",
        edition,
        owned: true,
      });
      expect(evidence.binding).toMatchObject({
        mediaId: f.input.mediaId,
        edition,
      });
      expect(evidence.adds).toBe(1);
      expect(
        await f.movie.observeMovieAcquisitionV4(
          attempt,
          testPlexBindingExecution(),
        ),
      ).toEqual({ status: "ready", reason: "resume_committed_publication" });
    } finally {
      await f.close();
    }
  },
);
