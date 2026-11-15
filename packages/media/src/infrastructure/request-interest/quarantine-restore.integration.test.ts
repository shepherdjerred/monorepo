import { expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { RequestInterestCommands } from "./commands.ts";
import { MediaRequestCommands } from "#infrastructure/request-commands.ts";
import { automationTestHarness } from "#testing/automation.ts";
import {
  boundRetentionFixture,
  prepareBoundRetention,
} from "#automation/retention/lifecycle.test-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { createPublicationActivities } from "#automation/publication.ts";
import { createMovieRetentionFixture } from "#testing/movie-workflow/retention-fixture.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { observeRequesterWatch } from "#automation/watch.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import { restoreMovieFilesV4 } from "#automation/movie-editions/retention/restore.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import {
  retentionMovieFixtures,
  acceptedFixtureMovieWarning,
} from "#testing/retention/movie-fixtures.ts";
import { seedFixtureReleasedEpisodes } from "#testing/retention-interest.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { continueQuarantinedInterest } from "./quarantine-release.test-fixture.ts";

const h = automationTestHarness();
const movies = retentionMovieFixtures();
const close = movies.closers;
type Subject = {
  db: Database;
  user: MediaActor;
  mediaId: string;
  edition: MovieEditionKey;
};

async function continued(subject: Subject) {
  const { db, user, mediaId, edition } = subject;
  const prior = await db.operation.findMany({
    where: { userId: user.id, targetId: mediaId },
    select: { id: true },
  });
  const original = await db.libraryAsset.findMany({
    where: { coverage: { some: { mediaId, edition, current: true } } },
  });
  const attempts = await db.acquisitionAttempt.findMany({
    where: { mediaIds: { has: mediaId } },
    orderBy: { id: "asc" },
  });
  const renewal = await continueQuarantinedInterest(
    { db },
    user,
    mediaId,
    edition,
  );
  const operation = await db.operation.findMany({
    where: {
      userId: user.id,
      targetId: mediaId,
      id: { notIn: prior.map((row) => row.id) },
    },
    include: { outbox: true },
  });
  expect(operation).toHaveLength(1);
  const selected = operation[0];
  if (selected === undefined)
    throw new Error("Continue omitted its native outbox command");
  expect(selected.outbox?.payload).toEqual(selected.payload);
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId, edition } },
  });
  expect(await renewal.replay()).toEqual(renewal.result);
  expect(
    await db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId, edition } },
    }),
  ).toEqual(target);
  expect(
    await db.operation.findMany({
      where: {
        userId: user.id,
        targetId: mediaId,
        id: { notIn: prior.map((row) => row.id) },
      },
      include: { outbox: true },
    }),
  ).toEqual(operation);
  expect(
    await db.acquisitionAttempt.findMany({
      where: { mediaIds: { has: mediaId } },
      orderBy: { id: "asc" },
    }),
  ).toEqual(attempts);
  expect(
    await db.libraryAsset.findMany({
      where: { coverage: { some: { mediaId, edition, current: true } } },
    }),
  ).toEqual(original);
  return selected;
}

async function ordinary() {
  const f = await boundRetentionFixture(h.database(), h.context());
  close.push(() => rm(f.files.directory, { recursive: true, force: true }));
  expect(await f.quarantine()).toEqual({ status: "quarantined" });
  return f;
}

test("Keep watching restores an actual legacy-default quarantine through its existing Files and Plex producers", async () => {
  const f = await ordinary();
  const original = await h.database().operation.findUniqueOrThrow({
    where: { id: f.retention.input.operationId },
  });
  const command = await continued({
    db: h.database(),
    user: f.files.user,
    mediaId: f.files.media.id,
    edition: "default",
  });
  expect(command.kind).toBe("restore_media");
  const input = z
    .object({ operationId: z.uuid(), mediaId: z.uuid(), generation: z.int() })
    .parse(command.payload);
  expect(
    await createMediaFileActivities(f.files.context).restoreMediaFiles(input),
  ).toEqual({ status: "restored" });
  expect(
    await createPublicationActivities(f.context).publishRestoredMedia(input),
  ).toEqual({ status: "available", reason: null });
  expect(
    await h
      .database()
      .operation.findUniqueOrThrow({ where: { id: original.id } }),
  ).toEqual(original);
  expect(
    await h
      .database()
      .libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
  ).toMatchObject({
    state: "published",
    checksum: f.asset.checksum,
    path: f.asset.path,
  });
}, 60_000);

function movieFiles(
  f: Awaited<ReturnType<typeof createMovieRetentionFixture>>,
) {
  const execution = testPublicationExecution();
  return {
    ...f.source.files.context,
    publicationExecution: () => execution,
    movieManagement: {
      execution,
      budget: new PublicationAuthorityReadBudget(),
    },
  };
}

test.each(["default", "directors_cut"] as const)(
  "Keep watching uses the actual V4 %s quarantine parent without a new movie choice or acquisition",
  async (edition) => {
    const f = await createMovieRetentionFixture(edition, movies.bytes());
    close.push(f.close);
    const { due, now } = await acceptedFixtureMovieWarning(
      f,
      "Native V4 quarantine prerequisite failed",
    );
    await quarantineMovieFilesV4(
      { ...movieFiles(f), now },
      {
        schemaVersion: 4,
        operationId: f.input.operationId,
        decisionId: due.decisionId,
        scope: f.scope,
      },
    );
    const parent = await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    });
    const before = await f.db.mediaRequest.findUniqueOrThrow({
      where: {
        userId_mediaId_edition: {
          userId: f.source.user.id,
          mediaId: f.scope.mediaId,
          edition,
        },
      },
    });
    f.source.wire.setWatched(false);
    const execution = testPlexBindingExecution();
    expect(
      await observeRequesterWatch(
        {
          ...f.context,
          now: () => new Date(),
          plexBindingExecution: () => execution,
          movieManagement: {
            execution,
            budget: new PublicationAuthorityReadBudget(),
          },
        },
        f.scope.mediaId,
        { edition },
      ),
    ).toEqual({ complete: true, reason: null });
    expect(
      await f.db.operation.count({
        where: {
          targetId: f.scope.mediaId,
          kind: "restore_movie_edition_v4",
        },
      }),
    ).toBe(0);
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({ where: { id: before.id } }),
    ).toEqual(before);
    const command = await continued({
      db: f.db,
      user: f.source.user,
      mediaId: f.scope.mediaId,
      edition,
    });
    expect(command.kind).toBe("restore_movie_edition_v4");
    const input = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(command.payload),
    );
    expect(input.scope).toEqual(f.scope);
    const current = await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(current.movieEditionChoiceId).toBe(before.movieEditionChoiceId);
    expect(current.movieEditionChoiceRevision).toBe(
      before.movieEditionChoiceRevision,
    );
    await restoreMovieFilesV4(movieFiles(f), input);
    expect(
      await f.db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toMatchObject({
      state: "published",
      checksum: f.asset.checksum,
      path: f.asset.path,
    });
    expect(
      await f.db.operation.findUniqueOrThrow({ where: { id: parent.id } }),
    ).toEqual(parent);
  },
  60_000,
);

test.each(["wrong_actor", "stale", "cancelled"] as const)(
  "Keep watching rejects %s consent without changing the actual quarantine or queuing restoration",
  async (mode) => {
    const f = await ordinary();
    const db = h.database();
    let request = await db.mediaRequest.findUniqueOrThrow({
      where: { id: f.files.request.id },
    });
    let actor: MediaActor = f.files.user;
    if (mode === "cancelled") {
      await new MediaRequestCommands(db, { keepDays: 30 }).cancelRequest(
        actor,
        crypto.randomUUID(),
        request.id,
        request.version,
      );
      request = await db.mediaRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      expect(request).toMatchObject({
        active: false,
        direct: false,
        excluded: true,
      });
    }
    if (mode === "wrong_actor")
      actor = await db.mediaUser.create({
        data: {
          plexAccountId: crypto.randomUUID(),
          displayName: "Another requester",
        },
      });
    const before = {
      request,
      target: await db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
        },
      }),
      asset: await db.libraryAsset.findUniqueOrThrow({
        where: { id: f.asset.id },
      }),
      operations: await db.operation.findMany({
        where: { targetId: f.files.media.id },
        orderBy: { id: "asc" },
      }),
    };
    await expect(
      new RequestInterestCommands(db, { keepDays: 30 }).execute(
        actor,
        crypto.randomUUID(),
        {
          schemaVersion: 1,
          requestId: request.id,
          expectedVersion: request.version - (mode === "stale" ? 1 : 0),
          expectedInterestRevision: request.interestRevision,
          action: "continue",
        },
      ),
    ).rejects.toMatchObject({
      code:
        mode === "wrong_actor"
          ? "forbidden"
          : mode === "stale"
            ? "version_conflict"
            : "request_not_active",
    });
    expect(
      await db.mediaRequest.findUniqueOrThrow({ where: { id: request.id } }),
    ).toEqual(before.request);
    expect(
      await db.mediaIntent.findUniqueOrThrow({
        where: {
          mediaId_edition: { mediaId: f.files.media.id, edition: "default" },
        },
      }),
    ).toEqual(before.target);
    expect(
      await db.libraryAsset.findUniqueOrThrow({ where: { id: f.asset.id } }),
    ).toEqual(before.asset);
    expect(
      await db.operation.findMany({
        where: { targetId: f.files.media.id },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.operations);
  },
  60_000,
);

test("Keep watching a released container re-expands real inherited claims and routes restoration for the exact shared physical cohort", async () => {
  const db = h.database();
  const files = await sharedTvFileFixture(db, mappedPublicationFixture);
  close.push(() => rm(files.directory, { recursive: true, force: true }));
  await seedFixtureReleasedEpisodes(db, files.user.id);
  const f = await prepareBoundRetention(
    files,
    await preparePhysicalPublication(files),
    h.context(),
  );
  expect(await f.quarantine()).toEqual({ status: "quarantined" });
  const mediaId = files.media.parentId;
  if (mediaId === null)
    throw new Error("Shared fixture lost its canonical series");
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Series requester",
    },
  });
  const mapping = await db.plexIdentityMapping.findUniqueOrThrow({
    where: { userId: files.user.id },
  });
  await db.plexIdentityMapping.create({
    data: {
      ...mapping,
      userId: user.id,
      serverAccountId: user.plexAccountId,
      homeUserId: null,
    },
  });
  await db.credential.create({
    data: {
      userId: user.id,
      kind: "plex",
      ciphertext: f.context.cipher.encrypt(
        JSON.stringify({ serverToken: `synthetic-series:${user.id}` }),
        `plex:${user.plexAccountId}`,
      ),
    },
  });
  const requestCommands = new MediaRequestCommands(db, {
    keepDays: 30,
    serverMachineId: mapping.serverMachineId,
  });
  const requested = await requestCommands.createRequest(
    user,
    crypto.randomUUID(),
    {
      mediaId,
      keepingPolicy: "temporary",
      subtitleLanguages: [],
      includeFutureEpisodes: true,
      includeSpecials: false,
    },
  );
  let request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: z.uuid().parse(requested.requestId) },
  });
  const expand = createCoverageActivities({ db });
  await expand.expandMediaRequest({
    operationId: z.uuid().parse(requested.operationId),
    requestId: request.id,
    requestVersion: request.version,
    cursor: null,
  });
  request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  await new RequestInterestCommands(db, { keepDays: 30 }).execute(
    user,
    crypto.randomUUID(),
    {
      schemaVersion: 1,
      requestId: request.id,
      expectedVersion: request.version,
      expectedInterestRevision: request.interestRevision,
      action: "finished",
    },
  );
  const released = await db.mediaRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  const releaseExpansion = await db.operation.findFirstOrThrow({
    where: {
      kind: "expand_request",
      targetId: mediaId,
      payload: { path: ["requestVersion"], equals: released.version },
    },
  });
  await expand.expandMediaRequest(
    z
      .object({
        operationId: z.uuid(),
        requestId: z.uuid(),
        requestVersion: z.int(),
        cursor: z.null(),
      })
      .parse(releaseExpansion.payload),
  );
  expect(
    await db.mediaRequest.findMany({
      where: { userId: user.id, mediaId: { in: f.published.entry.mediaIds } },
      select: { active: true, direct: true, interestState: true },
    }),
  ).toEqual([
    { active: false, direct: false, interestState: "following" },
    { active: false, direct: false, interestState: "following" },
  ]);
  const command = await continued({ db, user, mediaId, edition: "default" });
  expect(command.kind).toBe("expand_request");
  const input = z
    .object({
      operationId: z.uuid(),
      requestId: z.uuid(),
      requestVersion: z.int(),
      cursor: z.null(),
    })
    .parse(command.payload);
  const baseline = await db.operation.findMany({
    where: {
      kind: "restore_media",
      targetId: { in: f.published.entry.mediaIds },
    },
    select: { id: true },
  });
  expect(await expand.expandMediaRequest(input)).toMatchObject({
    processed: 2,
    nextCursor: null,
  });
  const restored = await db.operation.findMany({
    where: {
      kind: "restore_media",
      targetId: { in: f.published.entry.mediaIds },
      id: { notIn: baseline.map((row) => row.id) },
    },
  });
  expect(
    restored
      .map((row) => z.uuid().parse(row.targetId))
      .sort((left, right) => left.localeCompare(right)),
  ).toEqual(
    [...f.published.entry.mediaIds].sort((left, right) =>
      left.localeCompare(right),
    ),
  );
  expect(
    await db.requestCoverage.findMany({
      where: { rootRequestId: request.id },
      select: { active: true },
    }),
  ).toEqual([{ active: true }, { active: true }]);
  const selected = restored[0];
  if (selected === undefined)
    throw new Error("Container did not produce real restore demand");
  expect(
    await createMediaFileActivities(files.context).restoreMediaFiles(
      z
        .object({
          operationId: z.uuid(),
          mediaId: z.uuid(),
          generation: z.int(),
        })
        .parse(selected.payload),
    ),
  ).toEqual({ status: "restored" });
}, 60_000);
