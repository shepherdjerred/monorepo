import { afterEach, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createManagedMovieFixture } from "#testing/movie-workflow/managed-fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import type { MediaActor } from "#application/auth.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";

const h = automationTestHarness();
const directories: string[] = [];
let original: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  original = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test.each(MovieEditionKeySchema.options)(
  "creating and cancelling a real personal %s request preserves an independent household transfer through Plex publication",
  async (edition) => {
    const db = h.database();
    const f = await createManagedMovieFixture(
      h,
      edition,
      (directory) => directories.push(directory),
      { original, upgrade },
    );
    const selected = { mediaId: f.scope.mediaId, edition };
    expect(await db.mediaRequest.count({ where: selected })).toBe(0);
    const reserved = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(reserved.status).toBe("acquire");
    if (reserved.attemptId === null)
      throw new Error("Household transfer missing");
    const input = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      attemptId: reserved.attemptId,
      scope: f.scope,
    };
    const before = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    const target = await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: selected },
    });
    expect(target.libraryMonitoring).toBe(true);
    const user = await db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Independent movie requester",
      },
    });
    await grantTestRequesterAccess(db, user.id, "fixture-server");
    const actor: MediaActor = { ...user, role: "member" };
    const chosen = await chooseTestMovieEdition(db, {
      actor,
      mediaId: f.scope.mediaId,
      edition,
      access: { serverMachineId: "fixture-server", movieSectionId: "1" },
    });
    const requests = await chosen.app.listMovieEditionRequests(actor, {
      subjectUserId: actor.id,
      cursor: null,
    });
    const request = requests.items.find(
      (item) => item.requestId === chosen.result.requestId,
    );
    if (request === undefined) throw new Error("Real personal request missing");
    await chosen.app.cancelMovieEditionRequest(actor, crypto.randomUUID(), {
      schemaVersion: 3,
      action: "cancel_request",
      subjectUserId: actor.id,
      scope: request.scope,
      requestId: request.requestId,
      expected: {
        targetVersion: request.targetVersion,
        requestVersion: request.requestVersion,
        choiceRevision: request.choiceRevision,
      },
    });
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: { mediaId_edition: selected },
      }),
    ).toMatchObject({
      generation: target.generation,
      libraryMonitoring: true,
      monitoring: true,
      desiredPresence: true,
    });
    expect(
      await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    expect(
      await f.movie.observeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    expect(
      await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    expect(
      await db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
        include: { reservations: true, torrent: true },
      }),
    ).toMatchObject({
      state: "completed",
      sponsorRequestId: null,
      identityEvidence: before.identityEvidence,
      movieEditionAuthority: before.movieEditionAuthority,
      reservations: [],
      torrent: { owned: true },
    });
    expect(
      await db.mediaRequest.count({ where: { ...selected, active: true } }),
    ).toBe(0);
    expect(await db.mediaRequest.count({ where: selected })).toBe(1);
    expect(f.wire.additions()).toBe(1);
  },
  60_000,
);
