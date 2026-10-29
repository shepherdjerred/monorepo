import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { createManagedMovieFixture } from "#testing/movie-workflow/managed-fixture.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { rm } from "node:fs/promises";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import {
  MovieEditionKeySchema,
  type MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { MovieRetryRenewalEnvelopeV1Schema } from "#shared/movie-editions/retry/v1.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaAuth } from "#application/auth.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
let upgrade: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
  upgrade = await movieVideoFixture(3840, undefined, { bitrateKbps: 160_000 });
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
type WorkflowStatus = NonNullable<
  Awaited<ReturnType<MediaAutomationContext["describeWorkflow"]>>
>["status"];

async function submitted(edition: MovieEditionKey = "extended_cut") {
  const f = await createMovieWorkflowFixture(edition, { bytes });
  closers.push(f.close);
  const reconciled = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(reconciled.status).toBe("acquire");
  if (reconciled.attemptId === null)
    throw new Error("Actual movie coordinator omitted its attempt");
  const input = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    attemptId: reconciled.attemptId,
    scope: f.input.scope,
  };
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  const attempt = await f.source.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  if (attempt.torrentId === null)
    throw new Error("Actual submitted transfer omitted its torrent");
  const torrent = await f.source.db.torrent.findUniqueOrThrow({
    where: { id: attempt.torrentId },
  });
  const execution = testPlexBindingExecution();
  const observed = await f.source.context.qbittorrent.observe(
    torrent.infoHash,
    execution.signal,
  );
  if (observed === null) throw new Error("Actual created transfer disappeared");
  await f.finishMediaOperation({
    operationId: input.operationId,
    status: "reconciling",
    reason: "movie_operation_failed",
  });
  return {
    ...f,
    attemptInput: input,
    birth: attempt,
    transfer: observed,
    torrent,
  };
}
type RetryFixture = {
  source: { db: Database; user: MediaActor; context: MediaAutomationContext };
  input: MovieOperationV4;
  birth: AcquisitionAttempt;
};

function literalBirth(attempt: AcquisitionAttempt) {
  return {
    id: attempt.id,
    operationId: attempt.operationId,
    edition: attempt.edition,
    mediaIds: attempt.mediaIds,
    generations: attempt.generations,
    releaseId: attempt.releaseId,
    recoveryEpoch: attempt.recoveryEpoch,
    sponsorRequestId: attempt.sponsorRequestId,
    movieEditionChoiceId: attempt.movieEditionChoiceId,
    movieEditionChoiceRevision: attempt.movieEditionChoiceRevision,
    movieEditionAuthority: attempt.movieEditionAuthority,
    identityEvidence: attempt.identityEvidence,
  };
}

async function expectFileContent(file: string, expected: Uint8Array) {
  const actual = await readFile(file);
  expect({
    size: actual.byteLength,
    sha256: createHash("sha256").update(actual).digest("hex"),
  }).toEqual({
    size: expected.byteLength,
    sha256: createHash("sha256").update(expected).digest("hex"),
  });
}

/** Actual PIN/session persistence verifies the approving owner's current access; only Plex's auth port is synthetic. */
async function authenticateOwner(input: RetryFixture["source"]) {
  const serverMachineId = z
    .string()
    .min(1)
    .parse(input.context.serverMachineId);
  const page = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response("Synthetic owner Plex authorization", { status: 200 }),
  });
  closers.unshift(() => page.stop(true));
  const sections = await input.context.permittedSections();
  let verifications = 0;
  const auth = new MediaAuth(
    new PrismaAuthStore(input.db),
    {
      createPin: () =>
        Promise.resolve({
          id: 42,
          code: "synthetic-owner-code",
          expiresAt: new Date(Date.now() + 60_000),
          authorizationUrl: page.url.origin,
          deviceState: "synthetic-owner-device",
        }),
      resolvePin: (id, code, device) => {
        expect({ id, code, device }).toEqual({
          id: 42,
          code: "synthetic-owner-code",
          device: "synthetic-owner-device",
        });
        return Promise.resolve({
          accountId: input.user.plexAccountId,
          displayName: input.user.displayName,
          token: "synthetic-owner-account-token",
        });
      },
      resolveServerToken: () =>
        Promise.reject(
          new Error("Server access must be verified as a complete observation"),
        ),
      resolveServerAccess: (token) => {
        expect(token).toBe("synthetic-owner-account-token");
        verifications++;
        return Promise.resolve({
          accountId: input.user.plexAccountId,
          serverMachineId,
          serverToken: "synthetic-owner-server-token",
          permittedSectionIds: [sections.movie, sections.series],
          permittedMediaKinds: ["movie", "series"],
          plexRestricted: false,
        });
      },
      refresh: () =>
        Promise.reject(
          new Error("A fresh owner login must not refresh an old credential"),
        ),
    },
    input.context.cipher,
    { ownerAccountId: input.user.plexAccountId, sessionLifetimeMs: 60_000 },
  );
  const login = await auth.start();
  const authorization = await fetch(login.authorizationUrl);
  expect(authorization.status).toBe(200);
  const completed = await auth.poll(login.id, login.browserToken);
  if (completed === null)
    throw new Error("Actual owner PIN completion omitted its session");
  const authenticated = await auth.authenticate(completed.sessionToken);
  expect(verifications).toBe(2);
  expect(authenticated.actor).toMatchObject({
    id: input.user.id,
    plexAccountId: input.user.plexAccountId,
    role: "owner",
    restricted: false,
  });
  return authenticated.actor;
}

async function retry(f: RetryFixture) {
  const db = f.source.db;
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.input.mediaId },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.input.mediaId,
        edition: f.input.scope.edition,
      },
    },
  });
  const requests = await db.mediaRequest.findMany({
    where: { mediaId: media.id },
    orderBy: { id: "asc" },
  });
  const sections = await f.source.context.permittedSections();
  const commands = new MovieLifecycleCommands(db, {
    keepDays: 30,
    serverMachineId: z.string().min(1).parse(f.source.context.serverMachineId),
    movieSectionId: sections.movie,
  });
  const command = {
    schemaVersion: 4 as const,
    scope: f.input.scope,
    expected: { mediaVersion: media.version, targetVersion: target.version },
    command: { action: "retry" as const },
  };
  const key = crypto.randomUUID();
  const result = await commands.retryMovieEditionV4(
    f.source.user,
    key,
    command,
  );
  await expect(
    commands.retryMovieEditionV4(f.source.user, crypto.randomUUID(), command),
  ).rejects.toMatchObject({ code: "movie_retry_pending" });
  expect(
    await db.operation.count({
      where: {
        kind: "reconcile_movie_edition_v4",
        payload: { path: ["movieRetryV1", "attemptId"], equals: f.birth.id },
      },
    }),
  ).toBe(1);
  const operationId = z.uuid().parse(result.result.operationId);
  const operation = await db.operation.findUniqueOrThrow({
    where: { id: operationId },
    include: { outbox: true },
  });
  expect(operation.kind).toBe("reconcile_movie_edition_v4");
  expect(operation.outbox).not.toBeNull();
  expect(operation.id).not.toBe(f.birth.operationId);
  expect(
    await db.mediaItem.findUniqueOrThrow({ where: { id: media.id } }),
  ).toEqual(media);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: media.id, edition: target.edition },
      },
    }),
  ).toEqual(target);
  expect(
    await db.mediaRequest.findMany({
      where: { mediaId: media.id },
      orderBy: { id: "asc" },
    }),
  ).toEqual(requests);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
  ).toEqual(f.birth);
  const input = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(operation.payload),
  );
  expect(input.generation).toBe(f.input.generation);
  return { input, commands, command, key, result };
}

function recoveryContext(
  f: RetryFixture & {
    source: RetryFixture["source"] & { context: MediaAutomationContext };
    attemptInput: MovieAttemptOperationV4;
  },
) {
  // Media integration substitutes only Temporal's external description port;
  // a separate role journey verifies actual native Workflow executions.
  const control: {
    root: WorkflowStatus | null;
    child: WorkflowStatus | null;
    afterDescription?: () => void;
  } = { root: "FAILED", child: "FAILED" };
  const described: string[] = [];
  const context: MediaAutomationContext = {
    ...f.source.context,
    describeWorkflow: (id) => {
      described.push(id);
      const status =
        id === `media-operation-${f.attemptInput.operationId}`
          ? control.root
          : id === `media-acquire-${f.birth.id}`
            ? control.child
            : null;
      control.afterDescription?.();
      return Promise.resolve(
        status === null ? null : { status, runId: `synthetic-terminal:${id}` },
      );
    },
  };
  return { context, control, described };
}

test.each(MovieEditionKeySchema.options)(
  "%s same-choice retry resumes its exact Media transfer through actual Files and Plex without another add",
  async (edition) => {
    const f = await submitted(edition);
    const queued = await retry(f);
    const recovery = recoveryContext(f);
    const movie = createMovieNetworkFacetV4(recovery.context);
    const resumed = await movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    );
    expect(resumed).toMatchObject({ status: "acquire", attemptId: f.birth.id });
    expect(recovery.described).toContain(
      `media-operation-${f.birth.operationId}`,
    );
    expect(recovery.described).toContain(`media-acquire-${f.birth.id}`);
    const input = { ...f.attemptInput, operationId: queued.input.operationId };
    const claimed = await f.source.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    });
    expect(literalBirth(claimed)).toEqual(literalBirth(f.birth));
    expect(claimed.coordinatorOperationId).toBe(input.operationId);
    expect(
      await movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
    ).toMatchObject({ status: "submitted" });
    expect(
      await movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "ready", reason: null });
    expect(
      await f.fileMovie.inspectAndStageMovieV4(
        input,
        testPublicationExecution(),
      ),
    ).toEqual({ status: "staged" });
    const prepared = await f.source.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    });
    expect(
      await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).toEqual({ status: "published" });
    expect(
      await movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
    await movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
    const evidence = await f.evidence();
    expect(evidence.attempts).toHaveLength(1);
    const completed = await f.source.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    });
    expect(completed.state).toBe("completed");
    expect(literalBirth(completed)).toEqual(literalBirth(f.birth));
    expect(completed.filePlan).toEqual(prepared.filePlan);
    expect(completed.torrentId).toBe(f.torrent.id);
    expect(evidence.assets).toHaveLength(1);
    const asset = evidence.assets[0];
    if (asset === undefined)
      throw new Error("Retried publication omitted its real file");
    expect(asset).toMatchObject({ state: "published", edition, owned: true });
    await expectFileContent(
      workerFilePath(f.source.files.context, asset.path),
      bytes,
    );
    const execution = testPlexBindingExecution();
    expect(
      await f.source.context.qbittorrent.observe(
        f.torrent.infoHash,
        execution.signal,
      ),
    ).toEqual(f.transfer);
    expect(await f.source.db.torrent.count()).toBe(1);
    expect(evidence.adds).toBe(1);
    expect(
      await f.source.db.operation.count({
        where: { idempotencyKey: `seed:${f.torrent.id}` },
      }),
    ).toBe(1);
    expect(
      await queued.commands.retryMovieEditionV4(
        f.source.user,
        queued.key,
        queued.command,
        () =>
          Promise.reject(
            new Error("Committed retry replay must precede access refresh"),
          ),
      ),
    ).toEqual(queued.result);
  },
  60_000,
);

test.each([
  "root_running",
  "child_running",
  "child_missing",
  "cancel",
  "access",
  "epoch",
  "profile",
  "scope",
] as const)(
  "%s protects a queued retry without taking over the original transfer",
  async (change) => {
    const f = await submitted();
    const queued = await retry(f);
    const recovery = recoveryContext(f);
    if (change === "root_running") recovery.control.root = "RUNNING";
    if (change === "child_running") recovery.control.child = "RUNNING";
    if (change === "child_missing") recovery.control.child = null;
    if (change === "cancel") {
      const request = await f.source.db.mediaRequest.findUniqueOrThrow({
        where: { id: z.uuid().parse(f.birth.sponsorRequestId) },
      });
      const target = await f.source.db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.input.mediaId,
            edition: f.input.scope.edition,
          },
        },
      });
      await queued.commands.cancelMovieEditionRequest(
        f.source.user,
        crypto.randomUUID(),
        {
          schemaVersion: 3,
          action: "cancel_request",
          scope: f.input.scope,
          subjectUserId: f.source.user.id,
          requestId: request.id,
          expected: {
            targetVersion: target.version,
            requestVersion: request.version,
            choiceRevision: request.movieEditionChoiceRevision,
          },
        },
      );
    }
    if (change === "access")
      await f.source.db.plexIdentityMapping.update({
        where: { userId: f.source.user.id },
        data: { permittedSectionIds: [] },
      });
    if (change === "epoch")
      await f.source.db.mediaRuntimeState.update({
        where: { id: "singleton" },
        data: { recoveryEpoch: { increment: 1 } },
      });
    if (change === "profile")
      await f.source.db.qualityProfile.update({
        where: { id: f.source.profile.id },
        data: {
          version: { increment: 1 },
          versions: {
            create: {
              version: f.source.profile.version + 1,
              rules: z
                .record(z.string(), z.json())
                .parse(f.source.profile.rules),
            },
          },
        },
      });
    const before = await f.source.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    });
    const targetBefore = await f.source.db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: {
          mediaId: f.input.mediaId,
          edition: f.input.scope.edition,
        },
      },
    });
    const requestsBefore = await f.source.db.mediaRequest.findMany({
      where: { mediaId: f.input.mediaId },
      orderBy: { id: "asc" },
    });
    const input =
      change === "scope"
        ? {
            ...queued.input,
            scope: { ...queued.input.scope, edition: "directors_cut" as const },
          }
        : queued.input;
    const result = await createMovieNetworkFacetV4(
      recovery.context,
    ).reconcileMovieIntentV4(input, testPlexBindingExecution());
    expect(result.status).not.toBe("acquire");
    expect(
      await f.source.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: f.birth.id },
      }),
    ).toEqual(before);
    expect(
      await f.source.db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: {
            mediaId: f.input.mediaId,
            edition: f.input.scope.edition,
          },
        },
      }),
    ).toEqual(targetBefore);
    expect(
      await f.source.db.mediaRequest.findMany({
        where: { mediaId: f.input.mediaId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(requestsBefore);
    expect(await f.source.db.acquisitionAttempt.count()).toBe(1);
    expect(f.source.wire.additions()).toBe(1);
    expect(await f.source.db.libraryAsset.count()).toBe(0);
  },
  60_000,
);

test("an actual approved household retry resumes its own upgrade without personal request or choice authority", async () => {
  const cluster = await startMediaTestPostgres();
  const db = cluster.database;
  const directories: string[] = [];
  closers.push(async () => {
    try {
      await cluster.close();
    } finally {
      for (const directory of directories)
        await rm(directory, { recursive: true, force: true });
    }
  });
  const f = await createManagedMovieFixture(
    { database: () => db },
    "directors_cut",
    (directory) => directories.push(directory),
    { original: bytes, upgrade },
  );
  const approved = await db.mediaHandoffReceipt.findUniqueOrThrow({
    where: { id: f.receiptId },
  });
  expect(
    await db.mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
  const reconciled = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(reconciled.status).toBe("acquire");
  if (reconciled.attemptId === null)
    throw new Error("Actual household acquisition omitted its attempt");
  const attemptInput = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    attemptId: reconciled.attemptId,
    scope: f.scope,
  };
  expect(
    await f.movie.submitMovieTorrentV4(
      attemptInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "submitted", reason: null });
  const birth = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: reconciled.attemptId },
  });
  expect(birth).toMatchObject({
    sponsorRequestId: null,
    movieEditionChoiceId: null,
    movieEditionChoiceRevision: null,
    identityEvidence: { schemaVersion: 3 },
    movieEditionAuthority: {
      kind: "library_management",
      receiptId: f.receiptId,
    },
  });
  const finish = createOutboxActivities(db, () =>
    Promise.reject(new Error("Completion cannot dispatch")),
  );
  await finish.finishMediaOperation({
    operationId: f.input.operationId,
    status: "reconciling",
    reason: "movie_operation_failed",
  });
  const owner = await authenticateOwner({
    db,
    user: f.network.actor,
    context: f.context,
  });
  const adapter = {
    source: { db, user: owner, context: f.context },
    input: f.input,
    birth,
    attemptInput,
  };
  const queued = await retry(adapter);
  const recovery = recoveryContext(adapter);
  const movie = createMovieNetworkFacetV4(recovery.context);
  expect(
    await movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "acquire", attemptId: birth.id });
  const input = { ...attemptInput, operationId: queued.input.operationId };
  expect(
    await movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toMatchObject({ status: "submitted" });
  expect(
    await movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(input, testPublicationExecution()),
  ).toEqual({ status: "staged" });
  expect(
    await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
  ).toEqual({ status: "published" });
  expect(
    await movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "available", reason: null });
  await movie.finalizeMovieAcquisitionV4(input, testPlexBindingExecution());
  const completed = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  expect(completed).toMatchObject({
    state: "completed",
    coordinatorOperationId: queued.input.operationId,
    torrentId: birth.torrentId,
  });
  expect(literalBirth(completed)).toEqual(literalBirth(birth));
  expect(
    await db.mediaHandoffReceipt.findUniqueOrThrow({
      where: { id: f.receiptId },
    }),
  ).toEqual(approved);
  expect(
    await db.mediaRequest.count({ where: { mediaId: f.scope.mediaId } }),
  ).toBe(0);
  expect(
    await db.movieEditionChoice.count({
      where: { rootMediaId: f.scope.mediaId },
    }),
  ).toBe(0);
  expect(
    await db.acquisitionAttempt.count({
      where: { mediaIds: { has: f.scope.mediaId } },
    }),
  ).toBe(1);
  expect(await db.torrent.count()).toBe(1);
  expect(f.wire.additions()).toBe(1);
  const current = await db.assetCoverage.findFirstOrThrow({
    where: {
      mediaId: f.scope.mediaId,
      edition: f.scope.edition,
      current: true,
    },
    include: { asset: true },
  });
  expect(current.asset.path).toBe(f.target);
  expect(current.asset.checksum).toBe(
    createHash("sha256").update(upgrade).digest("hex"),
  );
  await expectFileContent(f.target, upgrade);
}, 60_000);

test("retry retains its original caller-owned100 allowance before adopting the actual transfer", async () => {
  const f = await submitted();
  const queued = await retry(f);
  const recovery = recoveryContext(f);
  const execution = testPlexBindingExecution();
  const budget = new PublicationAuthorityReadBudget();
  budget.consume(99);
  await expect(
    createMovieNetworkFacetV4({
      ...recovery.context,
      movieManagement: { execution, budget },
    }).reconcileMovieIntentV4(queued.input, execution),
  ).resolves.toEqual({
    status: "blocked",
    attemptId: null,
    reason: "archive_transition_reconciliation_required",
  });
  expect(() => budget.consume(0)).toThrow(NativeArchiveScopeProtection);
  expect(
    await f.source.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
  ).toEqual(f.birth);
  expect(await f.source.db.libraryAsset.count()).toBe(0);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);

test("SDK expiry during exact Workflow descriptions cannot grant retry a fresh capability", async () => {
  const f = await submitted();
  const queued = await retry(f);
  const recovery = recoveryContext(f);
  const original = testPlexBindingExecution();
  let expired = false;
  recovery.control.afterDescription = () => {
    expired = true;
  };
  const execution = {
    ...original,
    assertActive: () => {
      original.assertActive();
      if (expired) throw new Error("Original movie retry SDK expired");
    },
  };
  await expect(
    createMovieNetworkFacetV4(recovery.context).reconcileMovieIntentV4(
      queued.input,
      execution,
    ),
  ).rejects.toThrow("Original movie retry SDK expired");
  expect(expired).toBe(true);
  expect(
    await f.source.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
  ).toEqual(f.birth);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);

test("a journaled unknown add stays protected until its actual original tagged transfer becomes visible", async () => {
  const f = await createMovieWorkflowFixture("uncut_version", { bytes });
  closers.push(f.close);
  const reconciled = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  if (reconciled.attemptId === null)
    throw new Error("Actual ambiguous-add fixture omitted its reservation");
  const attemptInput = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    attemptId: reconciled.attemptId,
    scope: f.input.scope,
  };
  f.source.wire.control.loseAddReply = true;
  f.source.wire.control.beforeAddReply = () => {
    f.source.wire.control.visible = false;
    return Promise.resolve();
  };
  expect(
    await f.movie.submitMovieTorrentV4(
      attemptInput,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "blocked", reason: "outcome-unknown" });
  expect(f.source.wire.additions()).toBe(1);
  const birth = await f.source.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: reconciled.attemptId },
  });
  expect(birth).toMatchObject({
    state: "submission_unknown",
    torrentId: null,
    filePlan: null,
  });
  await f.finishMediaOperation({
    operationId: f.input.operationId,
    status: "reconciling",
    reason: "movie_operation_failed",
  });
  const adapter = { ...f, birth, attemptInput };
  const queued = await retry(adapter);
  const recovery = recoveryContext(adapter);
  const movie = createMovieNetworkFacetV4(recovery.context);
  expect(
    await movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "blocked", reason: "submission_outcome_unknown" });
  expect(
    await f.source.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: birth.id },
    }),
  ).toEqual(birth);
  expect(await f.source.db.torrent.count()).toBe(0);
  expect(f.source.wire.additions()).toBe(1);
  f.source.wire.control.visible = true;
  expect(
    await movie.reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "acquire", attemptId: birth.id });
  const renewed = await f.source.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  expect(literalBirth(renewed)).toEqual(literalBirth(birth));
  expect(renewed.coordinatorOperationId).toBe(queued.input.operationId);
  if (renewed.torrentId === null)
    throw new Error("Retry did not record its actual prior add");
  const torrent = await f.source.db.torrent.findUniqueOrThrow({
    where: { id: renewed.torrentId },
  });
  const observed = await f.source.context.qbittorrent.observe(
    torrent.infoHash,
    testPlexBindingExecution().signal,
  );
  if (observed === null)
    throw new Error(
      "Actual original transfer disappeared after reconciliation",
    );
  expect(() =>
    f.source.context.qbittorrent.validateOwnership(observed, {
      operationId: birth.operationId,
      attemptId: birth.id,
      savePath: `/downloads/media/${birth.id}`,
    }),
  ).not.toThrow();
  expect(await f.source.db.torrent.count()).toBe(1);
  expect(
    await f.source.db.operation.count({
      where: { idempotencyKey: `seed:${torrent.id}` },
    }),
  ).toBe(1);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);

test("stale retry CAS and an actual prepared publication cannot renew the old attempt", async () => {
  const f = await submitted("theatrical_cut");
  const db = f.source.db;
  const commands = new MovieLifecycleCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  const media = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.input.mediaId },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.input.mediaId,
        edition: f.input.scope.edition,
      },
    },
  });
  await expect(
    commands.retryMovieEditionV4(f.source.user, crypto.randomUUID(), {
      schemaVersion: 4,
      scope: f.input.scope,
      expected: {
        mediaVersion: media.version + 1,
        targetVersion: target.version,
      },
      command: { action: "retry" },
    }),
  ).rejects.toThrow();
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
  ).toEqual(f.birth);
  expect(
    await f.movie.observeMovieAcquisitionV4(
      f.attemptInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(
      f.attemptInput,
      testPublicationExecution(),
    ),
  ).toEqual({ status: "staged" });
  const prepared = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.birth.id },
  });
  expect(prepared.filePlan).not.toBeNull();
  const currentMedia = await db.mediaItem.findUniqueOrThrow({
    where: { id: f.input.mediaId },
  });
  const currentTarget = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.input.mediaId,
        edition: f.input.scope.edition,
      },
    },
  });
  await expect(
    commands.retryMovieEditionV4(f.source.user, crypto.randomUUID(), {
      schemaVersion: 4,
      scope: f.input.scope,
      expected: {
        mediaVersion: currentMedia.version,
        targetVersion: currentTarget.version,
      },
      command: { action: "retry" },
    }),
  ).rejects.toMatchObject({ code: "movie_retry_prepared_publication" });
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
  ).toEqual(prepared);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: {
          mediaId: f.input.mediaId,
          edition: f.input.scope.edition,
        },
      },
    }),
  ).toEqual(currentTarget);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);

test("the actual movie download sweep records a prior unknown add and its seeding duty after personal cancellation", async () => {
  const f = await createMovieWorkflowFixture("final_cut", { bytes });
  closers.push(f.close);
  const db = f.source.db;
  const reconciled = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  if (reconciled.attemptId === null)
    throw new Error("Actual cancelled-add fixture omitted its reservation");
  const input = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    attemptId: reconciled.attemptId,
    scope: f.input.scope,
  };
  f.source.wire.control.loseAddReply = true;
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toMatchObject({ status: "blocked", reason: "outcome-unknown" });
  const birth = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
  });
  expect(birth).toMatchObject({ state: "submission_unknown", torrentId: null });
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: z.uuid().parse(birth.sponsorRequestId) },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: {
        mediaId: f.input.mediaId,
        edition: f.input.scope.edition,
      },
    },
  });
  const commands = new MovieLifecycleCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  await commands.cancelMovieEditionRequest(f.source.user, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "cancel_request",
    scope: f.input.scope,
    subjectUserId: f.source.user.id,
    requestId: request.id,
    expected: {
      targetVersion: target.version,
      requestVersion: request.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
  await createSweepActivities({
    ...f.source.context,
    describeWorkflow: () =>
      Promise.resolve({
        status: "RUNNING",
        runId: "synthetic-original-active-workflow",
      }),
  }).sweepMediaWork({
    kind: "downloads",
    cursor: null,
    sweepId: crypto.randomUUID(),
  });
  const reconciledAdd = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: birth.id },
  });
  expect(literalBirth(reconciledAdd)).toEqual(literalBirth(birth));
  expect(reconciledAdd).toMatchObject({
    state: "cancelled",
    coordinatorOperationId: birth.coordinatorOperationId,
  });
  if (reconciledAdd.torrentId === null)
    throw new Error(
      "Sweep failed to record the actual prior add after cancellation",
    );
  expect(
    await db.torrent.findUniqueOrThrow({
      where: { id: reconciledAdd.torrentId },
    }),
  ).toMatchObject({ owned: true, ownershipEpoch: birth.recoveryEpoch });
  expect(
    await db.operation.count({
      where: { idempotencyKey: `seed:${reconciledAdd.torrentId}` },
    }),
  ).toBe(1);
  expect(
    await db.acquisitionReservation.count({ where: { attemptId: birth.id } }),
  ).toBe(0);
  expect(
    await db.operation.count({
      where: {
        kind: "reconcile_movie_edition_v4",
        payload: { path: ["movieRetryV1", "attemptId"], equals: birth.id },
      },
    }),
  ).toBe(0);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);

test("SQL requires the actual same-transaction retry receipt and keeps captured commands and recorded renewals immutable", async () => {
  const f = await submitted("unrated_cut");
  const queued = await retry(f);
  const db = f.source.db;
  const execution = testPlexBindingExecution();
  const freshness = plexBindingFreshness({
    observed: execution.observed,
    expiresAtMs: execution.expiresAtMs,
    guards: [execution],
  });
  await expect(
    db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness);
      await tx.$executeRaw`UPDATE "AcquisitionAttempt" SET "coordinatorOperationId"=${queued.input.operationId} WHERE id=${f.birth.id}`;
    }),
  ).rejects.toThrow("same-transaction immutable renewal receipt");
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.birth.id },
    }),
  ).toEqual(f.birth);
  const selected = await db.operation.findUniqueOrThrow({
    where: { id: queued.input.operationId },
  });
  await expect(
    db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness);
      await tx.$executeRaw`UPDATE "Operation" SET payload=jsonb_set(payload,'{movieRetryV1,generation}','999'::jsonb) WHERE id=${queued.input.operationId}`;
    }),
  ).rejects.toThrow("Movie retry command and original selection are immutable");
  await expect(
    db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness);
      await tx.$executeRaw`DELETE FROM "Operation" WHERE id=${queued.input.operationId}`;
    }),
  ).rejects.toThrow("Movie retry command and renewal are immutable");
  expect(
    await db.operation.findUniqueOrThrow({
      where: { id: queued.input.operationId },
    }),
  ).toEqual(selected);
  const recovery = recoveryContext(f);
  expect(
    await createMovieNetworkFacetV4(recovery.context).reconcileMovieIntentV4(
      queued.input,
      testPlexBindingExecution(),
    ),
  ).toMatchObject({ status: "acquire", attemptId: f.birth.id });
  const committed = await db.operation.findUniqueOrThrow({
    where: { id: queued.input.operationId },
  });
  const renewal = MovieRetryRenewalEnvelopeV1Schema.parse(
    z.object({ movieRetryRenewalV1: z.json() }).parse(committed.result)
      .movieRetryRenewalV1,
  );
  expect(renewal.receipt.capture.attemptId).toBe(f.birth.id);
  expect(renewal.receiptHash).toBe(identityHash(renewal.receipt));
  await expect(
    db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness);
      await tx.$executeRaw`UPDATE "Operation" SET result=result-'movieRetryRenewalV1' WHERE id=${queued.input.operationId}`;
    }),
  ).rejects.toThrow("Movie retry renewal receipt is immutable");
  await expect(
    db.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness);
      await tx.$executeRaw`UPDATE "Operation" SET result=jsonb_set(result,'{movieRetryRenewalV1,receipt,capture,generation}','999'::jsonb) WHERE id=${queued.input.operationId}`;
    }),
  ).rejects.toThrow("Movie retry renewal receipt is immutable");
  expect(
    await db.operation.findUniqueOrThrow({
      where: { id: queued.input.operationId },
    }),
  ).toEqual(committed);
  expect(f.source.wire.additions()).toBe(1);
}, 60_000);
