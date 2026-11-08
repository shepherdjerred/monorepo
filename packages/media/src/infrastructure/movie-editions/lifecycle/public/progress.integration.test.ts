import { beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { readMovieTargetProgressV4 } from "#infrastructure/movie-editions/lifecycle/public/public-progress.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  MovieEditionKeySchema,
  MovieEditionScopeSchema,
} from "#shared/movie-editions/registry.ts";
import { CancelMovieRequestV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";

let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});

for (const edition of MovieEditionKeySchema.options) {
  test(`actual ${edition} progress remains scoped, private and independent of playback before any Files publication`, async () => {
    const f = await createMovieWorkflowFixture(edition, { bytes });
    try {
      const db = f.source.db;
      const settings = {
        keepDays: 7,
        serverMachineId: "fixture-server",
        movieSectionId: "1",
      };
      const service = new PrismaMediaApplication(db, settings);
      const reserved = await f.movie.reconcileMovieIntentV4(
        f.input,
        testPlexBindingExecution(),
      );
      expect(reserved.status).toBe("acquire");
      const attemptId = z.uuid().parse(reserved.attemptId);
      const operation = {
        schemaVersion: 4 as const,
        operationId: f.input.operationId,
        scope: f.input.scope,
        attemptId,
      };
      const first = await service.getMovieTargetContextV4(
        f.source.user,
        f.input.scope,
      );
      expect(first).toMatchObject({
        access: "detail",
        currentAsset: null,
        progress: {
          attempts: [
            {
              id: attemptId,
              state: "reserved",
              torrentId: null,
              currentEpoch: true,
            },
          ],
          torrents: [],
          historyTruncated: false,
        },
      });
      expect(first).not.toHaveProperty("playback");
      expect(
        await f.movie.submitMovieTorrentV4(
          operation,
          testPlexBindingExecution(),
        ),
      ).toEqual({ status: "submitted", reason: null });
      f.source.wire.control.ratio = 0.5;
      f.source.wire.control.seedingSeconds = 60;
      expect(
        await f.movie.observeMovieAcquisitionV4(
          operation,
          testPlexBindingExecution(),
        ),
      ).toEqual({ status: "ready", reason: null });
      const recorded = await db.torrent.findFirstOrThrow({
        where: { attempts: { some: { id: attemptId } } },
      });
      const member = await service.getMovieTargetContextV4(
        f.source.user,
        f.input.scope,
      );
      if (member.access !== "detail")
        throw new Error(
          "Actual configured requester lost selected-cut progress access",
        );
      expect(member.currentAsset).toBeNull();
      expect(member.target.availability).not.toBe("available");
      expect(member.progress).toMatchObject({
        attempts: [
          { id: attemptId, torrentId: recorded.id, currentEpoch: true },
        ],
        torrents: [
          {
            id: recorded.id,
            state: "seeding",
            progress: 1,
            ratio: { kind: "finite", value: 0.5 },
            seededSeconds: 60,
            freshness: "fresh",
            diagnostics: null,
          },
        ],
        historyTruncated: false,
      });
      expect(member.progress).not.toHaveProperty("playback");
      expect(member.progress?.torrents[0]).not.toHaveProperty("infoHash");
      expect(member.progress?.torrents[0]).not.toHaveProperty("save_path");
      const budget = new PublicationAuthorityReadBudget();
      budget.consume(99);
      const limited = await db.$transaction((tx) =>
        readMovieTargetProgressV4(
          tx,
          { scope: f.input.scope, epoch: 0, owner: false, ownDemand: true },
          budget,
        ),
      );
      expect(limited).toMatchObject({
        attempts: [{ id: attemptId }],
        torrents: [],
        historyTruncated: true,
      });
      expect(budget.take).toBe(1);
      expect(
        await db.torrent.findUniqueOrThrow({ where: { id: recorded.id } }),
      ).toEqual(recorded);

      const other = edition === "directors_cut" ? "final_cut" : "directors_cut";
      await requestTestMovieV4(db, f.source.user, f.input.mediaId, other);
      const otherScope = MovieEditionScopeSchema.parse({
        ...f.input.scope,
        edition: other,
      });
      expect(
        await service.getMovieTargetContextV4(f.source.user, otherScope),
      ).toMatchObject({
        access: "detail",
        progress: { attempts: [], torrents: [], historyTruncated: false },
      });
      const request = await db.mediaRequest.findUniqueOrThrow({
        where: {
          userId_mediaId_edition: {
            userId: f.source.user.id,
            mediaId: f.input.mediaId,
            edition,
          },
        },
      });
      const target = await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.input.mediaId, edition } },
      });
      await service.cancelMovieEditionRequestV4(
        f.source.user,
        crypto.randomUUID(),
        CancelMovieRequestV4Schema.parse({
          schemaVersion: 4,
          scope: f.input.scope,
          subjectUserId: f.source.user.id,
          requestId: request.id,
          action: "cancel_request",
          expected: {
            targetVersion: target.version,
            requestVersion: request.version,
            choiceRevision: request.movieEditionChoiceRevision,
          },
        }),
      );
      expect(
        await service.getMovieTargetContextV4(f.source.user, f.input.scope),
      ).toMatchObject({ access: "detail", progress: null });
      const ownerRow = await db.mediaUser.findFirstOrThrow({
        where: { role: "owner" },
      });
      const owner = await authenticateMovieFixtureOwner(f.source.context, {
        ...ownerRow,
        role: "owner",
      });
      expect(
        await service.getMovieTargetContextV4(owner, f.input.scope),
      ).toMatchObject({
        access: "detail",
        progress: {
          torrents: [
            {
              id: recorded.id,
              progress: 1,
              diagnostics: { providerId: "knaben" },
            },
          ],
        },
      });
      expect(
        await db.torrent.findUniqueOrThrow({ where: { id: recorded.id } }),
      ).toEqual(recorded);
      expect(f.source.wire.additions()).toBe(1);
      expect(f.source.wire.control.deletes).toBe(0);
    } finally {
      await f.close();
    }
  }, 60_000);
}
