import { expect, test } from "vitest";
import { movieRequesterAccessFixture } from "#testing/movie-workflow/requester-access-fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import {
  refreshMovieAttemptRequesterAccessV4,
  refreshMovieCommandRequesterAccessV4,
} from "./requester-access.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { createMovieNetworkFacetV4 } from "./activities.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { z } from "zod";

async function submitted() {
  const f = await movieRequesterAccessFixture();
  try {
    const selected = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    if (selected.attemptId === null)
      throw new Error("Movie requester fixture did not acquire");
    const input = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      scope: f.input.scope,
      attemptId: selected.attemptId,
    };
    expect(
      await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "submitted", reason: null });
    const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    return { ...f, attempt, attemptInput: input };
  } catch (error) {
    await f.close();
    throw error;
  }
}

test("unattended movie search, submission and observation renew five-minute access without replacing consent or transfer", async () => {
  const f = await movieRequesterAccessFixture(await movieVideoFixture());
  try {
    await f.expire();
    const selected = await f.movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(selected.status).toBe("acquire");
    if (selected.attemptId === null)
      throw new Error("Real movie reservation omitted its attempt");
    const input = {
      schemaVersion: 4 as const,
      operationId: f.input.operationId,
      scope: f.input.scope,
      attemptId: selected.attemptId,
    };
    const birth = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    await f.expire();
    expect(
      await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toMatchObject({ status: "submitted" });
    const transfer = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    await f.expire();
    expect(
      await f.movie.observeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "ready", reason: null });
    const after = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    expect(after.identityEvidence).toEqual(birth.identityEvidence);
    expect(after.movieEditionAuthority).toEqual(birth.movieEditionAuthority);
    expect(after.sponsorRequestId).toBe(birth.sponsorRequestId);
    expect(after.coordinatorOperationId).toBe(birth.coordinatorOperationId);
    expect(after.torrentId).toBe(transfer.torrentId);
    expect(f.source.wire.additions()).toBe(1);
    expect(await f.db.mediaSession.count()).toBe(0);
    expect(f.calls.filter((path) => path === "/api/v2/resources")).toHaveLength(
      3,
    );
    const count = f.calls.length;
    expect(
      await f.movie.observeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "ready" });
    expect(f.calls).toHaveLength(count);
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        input,
        testPublicationExecution(),
      ),
    ).toMatchObject({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toMatchObject({ status: "published" });
    await f.expire();
    expect(
      await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.expire();
    await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    const completed = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    expect(completed.state).toBe("completed");
    expect(f.calls.filter((path) => path === "/api/v2/resources")).toHaveLength(
      5,
    );
    await f.expire();
    f.state.mode = "revoked";
    const priorCalls = f.calls.length;
    expect(
      await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await f.movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    expect(f.calls).toHaveLength(priorCalls);
  } finally {
    await f.close();
  }
});

test.each(["revoked", "mismatch", "restricted"] as const)(
  "movie requester renewal fails closed for %s access",
  async (mode) => {
    const f = await submitted();
    try {
      await f.expire();
      f.state.mode = mode;
      const result = await f.movie.observeMovieAcquisitionV4(
        f.attemptInput,
        testPlexBindingExecution(),
      );
      expect(result.status).toBe("blocked");
      expect(result.reason).not.toBeNull();
      const after = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.attempt.id },
      });
      expect(after.identityEvidence).toEqual(f.attempt.identityEvidence);
      expect(after.torrentId).toBe(f.attempt.torrentId);
      expect(f.source.wire.additions()).toBe(1);
      expect(await f.db.mediaSession.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test("movie renewal reuses its registered device when the account token expires", async () => {
  const f = await submitted();
  try {
    await f.expire();
    f.state.mode = "expired";
    expect(
      await f.movie.observeMovieAcquisitionV4(
        f.attemptInput,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "ready" });
    expect(f.calls).toContain("/api/v2/auth/token");
    const stored = await f.db.credential.findUniqueOrThrow({
      where: { userId_kind: { userId: f.source.user.id, kind: "plex" } },
    });
    expect(
      JSON.parse(f.network.cipher.decrypt(stored.ciphertext, "plex:81001")),
    ).toEqual({ ...f.credential, token: "movie-renewed-token" });
    expect(await f.db.mediaSession.count()).toBe(0);
  } finally {
    await f.close();
  }
});

test("movie renewal cannot exceed the shared allowance, cancelled invocation or retained edition scope", async () => {
  const f = await submitted();
  try {
    const before = await f.expire();
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    const execution = testPlexBindingExecution();
    await expect(
      refreshMovieAttemptRequesterAccessV4(
        { ...f.network, movieManagement: { execution, budget } },
        f.input.scope,
        f.attempt,
      ),
    ).rejects.toThrow(NativeArchiveScopeProtection);
    const controller = new AbortController();
    controller.abort();
    await expect(
      refreshMovieAttemptRequesterAccessV4(
        {
          ...f.network,
          movieManagement: {
            execution: { ...execution, signal: controller.signal },
            budget: new PublicationAuthorityReadBudget(),
          },
        },
        f.input.scope,
        f.attempt,
      ),
    ).rejects.toThrow();
    await expect(
      refreshMovieAttemptRequesterAccessV4(
        f.network,
        { ...f.input.scope, mediaId: crypto.randomUUID() },
        f.attempt,
      ),
    ).rejects.toThrow("retained edition scope");
    expect(f.calls).toEqual([]);
    const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
      where: { userId: f.source.user.id },
    });
    expect(mapping.verifiedAt).toEqual(before);
  } finally {
    await f.close();
  }
});

test("movie renewal retains the original SQL commit deadline", async () => {
  const f = await submitted();
  try {
    const before = await f.expire();
    await f.db.$executeRawUnsafe(
      "CREATE FUNCTION movie_access_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$",
    );
    await f.db.$executeRawUnsafe(
      'CREATE TRIGGER movie_access_delay AFTER UPDATE ON "PlexIdentityMapping" FOR EACH ROW EXECUTE FUNCTION movie_access_delay()',
    );
    const execution = testPlexBindingExecution();
    await expect(
      refreshMovieAttemptRequesterAccessV4(
        {
          ...f.network,
          movieManagement: {
            execution: {
              ...execution,
              expiresAtMs: execution.observed.wall + 75,
            },
            budget: new PublicationAuthorityReadBudget(),
          },
        },
        f.input.scope,
        f.attempt,
      ),
    ).rejects.toThrow(PlexBindingProtection);
    const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
      where: { userId: f.source.user.id },
    });
    expect(mapping.verifiedAt).toEqual(before);
  } finally {
    await f.close();
  }
});

test("personal due renews stale access on its one-target page before queueing scoped movie work", async () => {
  const f = await movieRequesterAccessFixture();
  try {
    await f.expire();
    const page = await createSweepActivities(f.network).sweepMediaWork({
      kind: "due",
      cursor: "personal-movie-due-v4:start",
      sweepId: "stale-movie-due",
    });
    expect(page).toEqual({ processed: 1, nextCursor: null });
    const due = await f.db.operation.findFirstOrThrow({
      where: {
        kind: "reconcile_movie_edition_v4",
        id: { not: f.input.operationId },
      },
      include: { outbox: true },
    });
    const request = await f.db.mediaRequest.findFirstOrThrow({
      where: {
        userId: f.source.user.id,
        mediaId: f.source.media.id,
        edition: "default",
      },
    });
    expect(due.payload).toMatchObject({
      requestId: request.id,
      scope: f.input.scope,
    });
    expect(due.outbox).not.toBeNull();
    expect(f.calls).toContain("/library/sections");
    expect(await f.db.mediaSession.count()).toBe(0);
  } finally {
    await f.close();
  }
});

test("downloads renews stale retained access and hands a completed blocked coordinator to the same acquisition", async () => {
  const f = await submitted();
  try {
    await f.finishMediaOperation({
      operationId: f.input.operationId,
      status: "reconciling",
      reason: "movie_edition_choice_changed",
    });
    await f.expire();
    const network = {
      ...f.network,
      describeWorkflow: (id: string) =>
        Promise.resolve({
          status: "COMPLETED" as const,
          runId: `closed:${id}`,
        }),
    };
    expect(
      await createSweepActivities(network).sweepMediaWork({
        kind: "downloads",
        cursor: null,
        sweepId: "stale-movie-recovery",
      }),
    ).toMatchObject({ processed: 1 });
    const queued = await f.db.operation.findFirstOrThrow({
      where: {
        kind: "reconcile_movie_edition_v4",
        payload: { path: ["movieRetryV1", "attemptId"], equals: f.attempt.id },
      },
      include: { outbox: true },
    });
    expect(queued.outbox).not.toBeNull();
    expect(f.calls).toContain("/library/sections");
    await f.expire();
    const input = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(queued.payload),
    );
    expect(
      await createMovieNetworkFacetV4(network).reconcileMovieIntentV4(
        input,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "acquire", attemptId: f.attempt.id });
    const resumed = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    });
    expect(resumed.coordinatorOperationId).toBe(queued.id);
    expect(resumed.operationId).toBe(f.attempt.operationId);
    expect(resumed.identityEvidence).toEqual(f.attempt.identityEvidence);
    expect(resumed.torrentId).toBe(f.attempt.torrentId);
    expect(f.source.wire.additions()).toBe(1);
    expect(await f.db.mediaSession.count()).toBe(0);
  } finally {
    await f.close();
  }
});

test("prebirth release commands renew only existing scope choices while explicit library work skips personal renewal", async () => {
  const f = await movieRequesterAccessFixture();
  try {
    await f.expire();
    await refreshMovieCommandRequesterAccessV4(f.network, f.input.scope, {
      releaseId: crypto.randomUUID(),
    });
    expect(f.calls).toContain("/library/sections");
    const count = f.calls.length;
    const stale = await f.expire();
    await refreshMovieCommandRequesterAccessV4(f.network, f.input.scope, {
      libraryManagementReceiptId: crypto.randomUUID(),
    });
    expect(f.calls).toHaveLength(count);
    const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
      where: { userId: f.source.user.id },
    });
    expect(mapping.verifiedAt).toEqual(stale);
    expect(await f.db.mediaSession.count()).toBe(0);
  } finally {
    await f.close();
  }
});
