import { expect, test, vi } from "vitest";
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
  refreshMovieScopeRequestersV4,
} from "./requester-access.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { createMovieNetworkFacetV4 } from "./activities.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { z } from "zod";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { MovieSubtitleOperationV4Schema } from "#shared/movie-editions/subtitles-v4.ts";
import { queueMovieSubtitleTargetsV4 } from "./subtitles/queue.ts";
import { currentMovieSubtitleWorkV4 } from "./subtitles/authority.ts";
import { captionProviderFixture } from "./notifications/caption-provider.test-fixture.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { MediaError } from "#application/errors.ts";
import { finalizeMovieAcquisitionV4 } from "./finalization.ts";
import { readMoviePlexReceiptV2 } from "#infrastructure/movie-editions/plex/receipt.ts";
import { readFile } from "node:fs/promises";
import { workerFilePath } from "#automation/files/paths/locations.ts";

async function reservedInput(
  f: Awaited<ReturnType<typeof movieRequesterAccessFixture>>,
) {
  const selected = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  if (selected.attemptId === null)
    throw new Error("Movie requester fixture did not acquire");
  return {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    scope: f.input.scope,
    attemptId: selected.attemptId,
  };
}

async function submitted(bytes?: Uint8Array) {
  const f = await movieRequesterAccessFixture(bytes);
  try {
    const input = await reservedInput(f);
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

async function imported(bytes: Uint8Array) {
  const f = await submitted(bytes);
  try {
    const input = f.attemptInput;
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
    ).toMatchObject({ status: "staged" });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toMatchObject({ status: "published" });
    return f;
  } catch (error) {
    await f.close();
    throw error;
  }
}

test.each(["legacy", "rollback"] as const)(
  "%s publication retries a real Plex503 without rolling back its original attempt or video",
  async (route) => {
    const f = await imported(await movieVideoFixture());
    try {
      const input = f.attemptInput;
      const publish = () =>
        route === "legacy"
          ? f.movie.publishMovieToPlexV4(input, testPlexBindingExecution())
          : f.movie.publishMovieWithRollbackV4(
              input,
              testPlexBindingExecution(),
              new PublicationAuthorityReadBudget(),
            );
      const attempt = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      expect(attempt.state).toBe("imported");
      const assets = await f.db.libraryAsset.findMany({
        orderBy: { id: "asc" },
      });
      const video = assets[0];
      if (video === undefined)
        throw new Error("Published movie fixture omitted its owned video");
      const path = workerFilePath(f.source.files.context, video.path);
      const bytes = await readFile(path);
      await f.expire();
      f.state.mode = "unavailable";
      await expect(publish()).rejects.toMatchObject({
        code: "plex_unavailable",
      });
      expect(f.calls).toContain("/api/v2/resources");
      expect(
        await f.db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: input.attemptId },
        }),
      ).toEqual(attempt);
      expect(
        await f.db.libraryAsset.findMany({ orderBy: { id: "asc" } }),
      ).toEqual(assets);
      expect(await readFile(path)).toEqual(bytes);
      expect(
        await readMoviePlexReceiptV2(
          f.db,
          input,
          new PublicationAuthorityReadBudget(),
        ),
      ).toBeNull();
      expect(
        await f.db.applicationEvent.count({
          where: { kind: "movie_plex_rejected_v1" },
        }),
      ).toBe(0);
      f.state.mode = "allowed";
      expect(await publish()).toEqual({ status: "available", reason: null });
      await f.movie.finalizeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      );
      const completed = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      expect(completed).toMatchObject({
        state: "completed",
        operationId: attempt.operationId,
        torrentId: attempt.torrentId,
        identityEvidence: attempt.identityEvidence,
      });
      expect(await readFile(path)).toEqual(bytes);
      expect(f.source.wire.additions()).toBe(1);
      expect(
        await f.db.applicationEvent.count({
          where: { kind: "movie_plex_rejected_v1" },
        }),
      ).toBe(0);
      await f.expire();
      f.state.mode = "unavailable";
      const calls = f.calls.length;
      expect(await publish()).toEqual({ status: "available", reason: null });
      expect(f.calls).toHaveLength(calls);
    } finally {
      await f.close();
    }
  },
);

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

type RequesterFixture = Awaited<ReturnType<typeof movieRequesterAccessFixture>>;
type DeniedAccess = "revoked" | "credentials";

async function denyRequester(f: RequesterFixture, mode: DeniedAccess) {
  await f.expire();
  if (mode === "revoked") f.state.mode = "revoked";
  else
    await f.db.credential.delete({
      where: {
        userId_kind: { userId: f.source.user.id, kind: "plex" },
      },
    });
}

async function secondRequester(f: RequesterFixture) {
  const created = await f.db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Independent permitted requester",
    },
  });
  const actor = { ...created, role: "member" as const };
  await grantTestRequesterAccess(f.db, actor.id, "fixture-server");
  const request = await requestTestMovieV4(f.db, actor, f.source.media.id, {
    edition: "default",
    subtitleLanguages: ["en"],
  });
  return { actor, request };
}

test.each([
  { mode: "revoked", independent: false },
  { mode: "credentials", independent: false },
  { mode: "revoked", independent: true },
  { mode: "credentials", independent: true },
] as const)(
  "committed movie settlement survives $mode denial with independent requester=$independent while retry remains strict",
  async ({ mode, independent }) => {
    const f = await imported(await movieVideoFixture(1920, []));
    try {
      const input = f.attemptInput;
      expect(
        await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
      ).toEqual({ status: "available", reason: null });
      const receipt = await readMoviePlexReceiptV2(
        f.db,
        input,
        new PublicationAuthorityReadBudget(),
      );
      expect(receipt).not.toBeNull();
      const before = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      expect(before.state).toBe("imported");
      const assets = await f.db.libraryAsset.findMany();
      const bindings = await f.db.plexBindingCurrent.findMany();
      const permitted = independent ? await secondRequester(f) : null;
      for (const userId of [f.source.user.id, permitted?.actor.id].filter(
        (id) => id !== undefined,
      ))
        await f.db.notificationPreference.create({
          data: { userId, emailEnabled: true },
        });
      const priorCaptions = await f.db.operation.findMany({
        where: { kind: "acquire_movie_subtitles_v4" },
      });
      await denyRequester(f, mode);
      await expect(
        finalizeMovieAcquisitionV4(
          f.network,
          input,
          testPlexBindingExecution(),
          true,
        ),
      ).rejects.toMatchObject({
        code:
          mode === "revoked"
            ? "plex_library_access_required"
            : "plex_credentials_required",
      });
      expect(
        await f.db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: input.attemptId },
        }),
      ).toEqual(before);
      expect(
        await f.db.acquisitionReservation.count({
          where: { attemptId: input.attemptId },
        }),
      ).toBe(1);
      await f.movie.finalizeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      );
      expect(
        await f.db.acquisitionAttempt.findUniqueOrThrow({
          where: { id: input.attemptId },
        }),
      ).toMatchObject({
        state: "completed",
        identityEvidence: before.identityEvidence,
        movieEditionAuthority: before.movieEditionAuthority,
        torrentId: before.torrentId,
      });
      expect(
        await f.db.acquisitionReservation.count({
          where: { attemptId: input.attemptId },
        }),
      ).toBe(0);
      const seeding = await f.db.operation.findMany({
        where: { kind: "maintain_torrent", targetId: before.torrentId },
        include: { outbox: true },
      });
      expect(seeding).toHaveLength(1);
      expect(seeding[0]?.outbox).not.toBeNull();
      const captions = await f.db.operation.findMany({
        where: { kind: "acquire_movie_subtitles_v4" },
      });
      expect(
        captions.filter((row) =>
          priorCaptions.some((old) => old.id === row.id),
        ),
      ).toEqual(priorCaptions);
      const newCaptions = captions.filter(
        (row) => !priorCaptions.some((old) => old.id === row.id),
      );
      expect(newCaptions).toHaveLength(independent ? 1 : 0);
      if (independent)
        expect(newCaptions[0]?.payload).toMatchObject({ language: "en" });
      const deliveries = await f.db.notificationDelivery.findMany();
      expect(deliveries.map((row) => row.userId)).toEqual(
        permitted === null ? [] : [permitted.actor.id],
      );
      expect(await f.db.libraryAsset.findMany()).toEqual(assets);
      expect(await f.db.plexBindingCurrent.findMany()).toEqual(bindings);
      expect(
        await readMoviePlexReceiptV2(
          f.db,
          input,
          new PublicationAuthorityReadBudget(),
        ),
      ).toEqual(receipt);
      const calls = f.calls.length;
      await f.movie.finalizeMovieAcquisitionV4(
        input,
        testPlexBindingExecution(),
      );
      expect(f.calls).toHaveLength(calls);
      expect(
        await f.db.operation.count({
          where: { kind: "maintain_torrent", targetId: before.torrentId },
        }),
      ).toBe(1);
      expect(f.source.wire.additions()).toBe(1);
      expect(await f.db.mediaSession.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test.each(["revoked", "credentials"] as const)(
  "personal movie due preserves an independent permitted requester after %s renewal is denied",
  async (mode) => {
    const f = await movieRequesterAccessFixture();
    try {
      const permitted = await secondRequester(f);
      const primary = await f.db.mediaRequest.findFirstOrThrow({
        where: { userId: f.source.user.id, mediaId: f.source.media.id },
      });
      await denyRequester(f, mode);
      expect(
        await createSweepActivities(f.network).sweepMediaWork({
          kind: "due",
          cursor: "personal-movie-due-v4:start",
          sweepId: "mixed-movie-due-" + mode,
        }),
      ).toEqual({ processed: 1, nextCursor: null });
      const due = await f.db.operation.findFirstOrThrow({
        where: {
          idempotencyKey: { startsWith: "personal-movie-due-v4:" },
        },
        include: { outbox: true },
      });
      expect(due.userId).toBe(permitted.actor.id);
      expect(due.payload).toMatchObject({
        requestId: permitted.request.result.requestId,
        scope: f.input.scope,
      });
      expect(due.outbox).not.toBeNull();
      await expect(
        refreshMovieCommandRequesterAccessV4(f.network, f.input.scope, {
          requestId: primary.id,
        }),
      ).rejects.toMatchObject({
        code:
          mode === "revoked"
            ? "plex_library_access_required"
            : "plex_credentials_required",
      });
      expect(await f.db.mediaSession.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test("caption acquisition continues for its permitted requester when another scope requester loses credentials", async () => {
  const f = await imported(await movieVideoFixture(1920, []));
  try {
    await secondRequester(f);
    await denyRequester(f, "credentials");
    const coverage = await f.db.assetCoverage.findFirstOrThrow({
      where: { mediaId: f.source.media.id, edition: "default", current: true },
    });
    const scope = f.input.scope;
    const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
    await f.db.$transaction((tx) =>
      queueMovieSubtitleTargetsV4(tx, {
        scope,
        assetId: coverage.assetId,
        epoch: 0,
        access,
      }),
    );
    const work = await currentMovieSubtitleWorkV4(
      f.db,
      { scope, assetId: coverage.assetId, epoch: 0, access },
      new PublicationAuthorityReadBudget(),
    );
    const operation = await f.db.operation.findFirstOrThrow({
      where: {
        kind: "acquire_movie_subtitles_v4",
        targetId: coverage.assetId,
        AND: [
          { payload: { path: ["targetAuthority"], equals: work.authority } },
          { payload: { path: ["language"], equals: "en" } },
        ],
      },
    });
    const subtitleInput = MovieSubtitleOperationV4Schema.parse(
      z.object(MovieSubtitleOperationV4Schema.shape).parse(operation.payload),
    );
    const network = createMovieNetworkFacetV4(
      f.network,
      await captionProviderFixture(f.network),
    );
    const found = await network.findMovieSubtitlesV4(
      subtitleInput,
      testPlexBindingExecution(),
    );
    expect(found.status).toBe("found");
    if (found.subtitleId === null)
      throw new Error("Independent requester caption was not persisted");
    expect(
      await f.db.subtitleAsset.findUniqueOrThrow({
        where: { id: found.subtitleId },
      }),
    ).toMatchObject({
      assetId: coverage.assetId,
      language: "en",
      state: "validated",
      qualityStatus: "accepted",
    });
    expect(await f.db.mediaSession.count()).toBe(0);
  } finally {
    await f.close();
  }
});

test("scope renewal keeps distinct managed subjects sharing the same owner", async () => {
  const f = await movieRequesterAccessFixture();
  try {
    const created = await f.db.mediaUser.create({
      data: {
        plexAccountId: crypto.randomUUID(),
        displayName: "Managed profile owner",
        role: "owner",
      },
    });
    const owner = { ...created, role: "owner" as const };
    await grantTestRequesterAccess(f.db, owner.id, "fixture-server");
    const subjects: string[] = [];
    for (let index = 0; index < 2; index++) {
      const subject = await f.db.mediaUser.create({
        data: {
          plexAccountId: crypto.randomUUID(),
          displayName: "Independent managed subject " + String(index),
        },
      });
      await grantTestRequesterAccess(f.db, subject.id, "fixture-server");
      await f.db.plexIdentityMapping.update({
        where: { userId: subject.id },
        data: { kind: "managed", homeUserId: crypto.randomUUID() },
      });
      await chooseTestMovieEdition(f.db, {
        actor: owner,
        subjectUserId: subject.id,
        mediaId: f.source.media.id,
        access: { serverMachineId: "fixture-server", movieSectionId: "1" },
      });
      subjects.push(subject.id);
    }
    const renewed: { actorId: string; userId: string }[] = [];
    await refreshMovieScopeRequestersV4(
      {
        ...f.network,
        refreshRequesterAccess: async (sponsors, execution, budget) => {
          renewed.push(...sponsors);
          await f.network.refreshRequesterAccess(sponsors, execution, budget);
        },
      },
      f.input.scope,
    );
    expect(
      renewed
        .filter((sponsor) => sponsor.actorId === owner.id)
        .map((sponsor) => sponsor.userId)
        .sort(),
    ).toEqual(subjects.sort());
  } finally {
    await f.close();
  }
});

test.each([
  "budget",
  "cancelled",
  "deadline",
  "version-conflict",
  "transport",
] as const)(
  "scope access-denial isolation still propagates its original %s guard",
  async (guard) => {
    const f = await movieRequesterAccessFixture();
    const original = testPlexBindingExecution();
    const abort = new AbortController();
    const clock = vi.spyOn(Date, "now").mockReturnValue(original.observed.wall);
    const freshness = plexBindingFreshness({
      observed: original.observed,
      expiresAtMs: original.expiresAtMs,
      guards: [original],
    });
    const execution = {
      ...original,
      signal: abort.signal,
      assertActive: freshness.assertActive,
    };
    try {
      const result = refreshMovieScopeRequestersV4(
        {
          ...f.network,
          movieManagement: {
            execution,
            budget: new PublicationAuthorityReadBudget(),
          },
          refreshRequesterAccess: (_sponsors, _execution, budget) => {
            if (guard === "version-conflict")
              return Promise.reject(
                new MediaError("version_conflict", "Mapping changed", 409),
              );
            if (guard === "transport")
              return Promise.reject(
                new Error("Synthetic Plex transport failure"),
              );
            if (guard === "budget") budget.consume(100);
            else if (guard === "cancelled") abort.abort();
            else clock.mockReturnValue(original.expiresAtMs + 1);
            return Promise.reject(
              new MediaError(
                "plex_credentials_required",
                "Synthetic principal refusal",
                409,
              ),
            );
          },
        },
        f.input.scope,
      );
      switch (guard) {
        case "budget":
          await expect(result).rejects.toThrow(NativeArchiveScopeProtection);
          break;
        case "cancelled":
          await expect(result).rejects.toMatchObject({ name: "AbortError" });
          break;
        case "version-conflict":
          await expect(result).rejects.toMatchObject({
            code: "version_conflict",
          });
          break;
        case "transport":
          await expect(result).rejects.toThrow(
            "Synthetic Plex transport failure",
          );
          break;
        case "deadline":
          await expect(result).rejects.toThrow(PlexBindingProtection);
          break;
      }
      expect(f.calls).toEqual([]);
    } finally {
      clock.mockRestore();
      await f.close();
    }
  },
);

test.each(["revoked", "credentials"] as const)(
  "a reserved movie still cannot add a torrent after %s access denial",
  async (mode) => {
    const f = await movieRequesterAccessFixture();
    try {
      const input = await reservedInput(f);
      await denyRequester(f, mode);
      expect(
        await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
      ).toMatchObject({
        status: "blocked",
        reason:
          mode === "revoked"
            ? "plex_library_access_required"
            : "plex_credentials_required",
      });
      expect(f.source.wire.additions()).toBe(0);
      expect(await f.db.torrent.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test.each(["revoked", "credentials"] as const)(
  "a proven lost add reply retains seeding responsibility after %s access denial without another add",
  async (mode) => {
    const f = await movieRequesterAccessFixture();
    try {
      const input = await reservedInput(f);
      f.source.wire.control.loseAddReply = true;
      expect(
        await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
      ).toEqual({ status: "blocked", reason: "outcome-unknown" });
      const before = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      expect(before).toMatchObject({
        state: "submission_unknown",
        torrentId: null,
      });
      await denyRequester(f, mode);
      const calls = f.calls.length;
      expect(
        await f.movie.reconcileMovieIntentV4(
          f.input,
          testPlexBindingExecution(),
        ),
      ).toEqual({
        status: "acquire",
        attemptId: input.attemptId,
        reason: null,
      });
      expect(await f.db.acquisitionAttempt.count()).toBe(1);
      expect(
        await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
      ).toEqual({ status: "submitted", reason: null });
      const after = await f.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      expect(after).toMatchObject({
        state: "cancelled",
        identityEvidence: before.identityEvidence,
        movieEditionAuthority: before.movieEditionAuthority,
        coordinatorOperationId: before.coordinatorOperationId,
      });
      if (after.torrentId === null)
        throw new Error("Proven prior add lost its seeding responsibility");
      const seeding = await f.db.operation.findMany({
        where: { kind: "maintain_torrent", targetId: after.torrentId },
        include: { outbox: true },
      });
      expect(seeding).toHaveLength(1);
      expect(seeding[0]?.outbox).not.toBeNull();
      expect(f.source.wire.additions()).toBe(1);
      expect(f.calls).toHaveLength(calls);
      expect(await f.db.mediaSession.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);
