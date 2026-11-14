/** Extended-only: real publication, native requester observations and personal commands. */
import { expect } from "vitest";
import { z } from "zod";
import type { automationTestHarness } from "#testing/automation.ts";
import type { Database } from "#infrastructure/database.ts";
import { mappedPublicationFixture } from "#automation/publication-proof/test-fixture.ts";
import { sharedTvFileFixture } from "#automation/native-archive/fixtures/shared-tv.ts";
import { prepareBoundRetention } from "#automation/retention/lifecycle.test-fixture.ts";
import { preparePhysicalPublication } from "#automation/plex-binding/test-fixture.ts";
import { seedFixtureReleasedEpisodes } from "#testing/retention-interest.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";
import { RequestInterestCommands } from "#infrastructure/request-interest/commands.ts";
import { createCoverageActivities } from "#automation/reconciliation/coverage.ts";
import { nativeInterestFacts } from "#infrastructure/request-interest/facts.ts";
import { reconcileRequestInterests } from "#infrastructure/request-interest/reconcile.ts";
import { queueExistingPlexBinding } from "#automation/plex-binding/queue.ts";
import { createPlexBindingActivities } from "#automation/plex-binding/activities.ts";
import { ReverifyPlexBindingInputSchema } from "#shared/plex-binding/activities.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { MovieRequestV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";

const DAY = 86_400_000;
export async function completionFixture(
  harness: ReturnType<typeof automationTestHarness>,
  tv = false,
  originalLanguage = "en",
  initiallyComplete = true,
) {
  const db = harness.database();
  // Declare the separate configured owner before any physical/viewer proof.
  // The real login producer grants no extra library access or requester claims.
  const auth = new PrismaAuthStore(db);
  const now = new Date();
  const ownerAccountId = "710099000001";
  const loginId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + 60_000);
  await auth.saveLogin({
    id: loginId,
    pinId: 1,
    pinCode: "synthetic-completion-owner",
    browserHash: "synthetic-completion-owner",
    expiresAt,
    encryptedDevice: "synthetic-unused-device",
  });
  const owner = await auth.completeLogin({
    loginId,
    now,
    accountId: ownerAccountId,
    ownerAccountId,
    displayName: "Synthetic completion owner",
    encryptedCredential: harness
      .context()
      .cipher.encrypt(
        JSON.stringify({ token: "synthetic-completion-owner-token" }),
        `plex:${ownerAccountId}`,
      ),
    access: {
      accountId: ownerAccountId,
      serverMachineId: "fixture-server",
      permittedSectionIds: [],
      permittedMediaKinds: [],
      plexRestricted: false,
    },
    sessionId: crypto.randomUUID(),
    csrfHash: "synthetic-completion-owner",
    expiresAt,
  });
  const plexAccountId = String(
    1 + z.int().parse(crypto.getRandomValues(new Uint32Array(1))[0]),
  );
  const mapped: typeof mappedPublicationFixture = (database, episode) =>
    mappedPublicationFixture(database, episode, { plexAccountId });
  const files = tv ? await sharedTvFileFixture(db, mapped) : await mapped(db);
  await db.mediaItem.update({
    where: { id: files.media.id },
    data: { originalLanguage },
  });
  if (tv) {
    await seedFixtureReleasedEpisodes(db, files.user.id);
    await db.mediaItem.update({
      where: { id: z.uuid().parse(files.media.parentId) },
      data: {
        originalLanguage: "en",
        catalogState: "ready",
        catalogCompletedAt: new Date(),
        seriesStatus: "ended",
        seriesStatusObservedAt: new Date(),
      },
    });
  }
  const f = await prepareBoundRetention(
    files,
    await preparePhysicalPublication(files),
    harness.context(),
  );
  let requestId = files.request.id;
  const rootId = tv ? z.uuid().parse(files.media.parentId) : files.media.id;
  const commands = new PrismaMediaCommands(db, {
    keepDays: 30,
    serverMachineId: "fixture-server",
  });
  if (tv) {
    const priorDefault = await db.qualityProfileDefault.findUnique({
      where: { kind: "series" },
    });
    await commands.setProfileDefault(owner, crypto.randomUUID(), "series", {
      expectedVersion: priorDefault?.version ?? 0,
      profileId: files.profile.id,
    });
    const created = await commands.createRequest(
      files.user,
      crypto.randomUUID(),
      {
        mediaId: rootId,
        subtitleLanguages: [],
        includeSpecials: false,
        includeFutureEpisodes: true,
        keepingPolicy: "temporary",
      },
    );
    requestId = z.uuid().parse(created.requestId);
    const root = await db.mediaRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    await createCoverageActivities({ db }).expandMediaRequest({
      requestId,
      requestVersion: root.version,
      cursor: null,
      operationId: z.uuid().parse(created.operationId),
    });
  }
  const read = () =>
    db.mediaRequest.findUniqueOrThrow({ where: { id: requestId } });
  const sweep = async (database: Database = db) => {
    const previous = await db.mediaRequest.findFirst({
      where: { id: { lt: requestId } },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    return reconcileRequestInterests(database, {
      cursor: previous?.id ?? null,
    });
  };
  if (tv) {
    if (!initiallyComplete) markIncompleteTv(f);
    await f.observe(true);
    await sweep();
  }
  expect(await read()).toMatchObject(
    initiallyComplete
      ? {
          interestState: "finished",
          interestReleaseReason: tv ? "series_finished" : "watched",
        }
      : { interestState: "following", interestReleaseReason: null },
  );
  const facts = async () =>
    db.$transaction(async (tx) =>
      nativeInterestFacts(tx, await read(), new Date()),
    );
  const observe = async (
    count: number,
    selected: readonly string[] = f.published.entry.mediaIds,
  ) => {
    for (const mediaId of selected) {
      const item = f.items.get(mediaId);
      if (item === undefined)
        throw new Error("Exact physical fixture item missing");
      f.state.viewCountOverrides.set(item.ratingKey, count);
    }
    await f.observe(count > 0);
  };
  const continued = async (daysAgo = 0) => {
    const request = await read();
    const renewalAt = new Date(Date.now() - daysAgo * DAY);
    const database =
      daysAgo === 0
        ? db
        : queryFixtureDatabase(db, {
            query: {
              mediaRequest: {
                async update({ args, query }) {
                  // Only this original personal-command policy-clock write is historical.
                  if (
                    args.where.id === requestId &&
                    args.data.completionRequiredAfter instanceof Date
                  ) {
                    args.data.completionRequiredAfter = renewalAt;
                    args.data.interestRenewedAt = renewalAt;
                  }
                  return query(args);
                },
              },
            },
          });
    await new RequestInterestCommands(database, { keepDays: 30 }).execute(
      files.user,
      crypto.randomUUID(),
      {
        schemaVersion: 1,
        requestId,
        expectedVersion: request.version,
        expectedInterestRevision: request.interestRevision,
        action: "continue",
      },
    );
    return read();
  };
  const refreshBinding = async () => {
    const queued = await queueExistingPlexBinding(f.context, f.asset.id);
    if (queued.status !== "queued")
      throw new Error(`Native rebind protected: ${queued.reason}`);
    const command = await db.operation.findUniqueOrThrow({
      where: { id: queued.operationId },
    });
    expect(
      await createPlexBindingActivities(f.context).reverify(
        ReverifyPlexBindingInputSchema.parse(command.payload),
        f.context.plexBindingExecution(),
      ),
    ).toMatchObject({ status: "verified" });
  };
  const requestAgain = async () => {
    if (tv) {
      const created = await commands.createRequest(
        files.user,
        crypto.randomUUID(),
        {
          mediaId: rootId,
          subtitleLanguages: [],
          includeSpecials: false,
          keepingPolicy: "temporary",
        },
      );
      const root = await read();
      await createCoverageActivities({ db }).expandMediaRequest({
        requestId: root.id,
        requestVersion: root.version,
        cursor: null,
        operationId: z.uuid().parse(created.operationId),
      });
      return created;
    }
    const settings = {
      keepDays: 30,
      serverMachineId: "fixture-server",
      movieSectionId: "1",
    };
    const current = await new PrismaMediaApplication(
      db,
      settings,
    ).getMovieEditionContext(files.user, rootId, files.user.id);
    const option = current.options.find((value) => value.edition === "default");
    if (option?.request == null)
      throw new Error("Actual re-request lost its previous declaration");
    return new MovieLifecycleCommands(db, settings).requestMovieEditionV4(
      files.user,
      crypto.randomUUID(),
      MovieRequestV4Schema.parse({
        schemaVersion: 4,
        mediaId: rootId,
        subjectUserId: files.user.id,
        expected: {
          mediaVersion: current.mediaVersion,
          targetVersion: option.targetVersion,
          definition: option.storedDefinition,
          request: {
            id: option.request.id,
            version: option.request.version,
            choiceRevision: option.request.choiceRevision,
          },
        },
        selection: {
          edition: "default",
          definitionVersion: option.definitionVersion,
          definitionDigest: option.definitionDigest,
          registryVersion: current.registryVersion,
        },
        options: { subtitleLanguages: [], keepingPolicy: "temporary" },
      }),
    );
  };
  return {
    ...f,
    db,
    files,
    owner,
    rootId,
    requestId,
    commands,
    read,
    sweep,
    facts,
    observe,
    continued,
    refreshBinding,
    requestAgain,
    unknown: () => f.observe(null),
  };
}

function markIncompleteTv(
  f: Awaited<ReturnType<typeof prepareBoundRetention>>,
) {
  const incompleteId = f.published.entry.mediaIds.at(-1);
  if (incompleteId === undefined)
    throw new Error("Partial native TV fixture omitted its last episode");
  const item = f.items.get(incompleteId);
  if (item === undefined)
    throw new Error("Partial native TV fixture omitted its last item");
  f.state.viewCountOverrides.set(item.ratingKey, 0);
}
