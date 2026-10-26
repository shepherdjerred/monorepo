import { expect, test } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { MovieRequestV4Schema } from "#shared/movie-editions/lifecycle-v4.ts";
import { MovieLifecycleCommands } from "./commands.ts";
import { captureMovieChoiceV4, assertMovieChoiceV4 } from "./authority.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertMovieAttemptChoice } from "#infrastructure/movie-editions/authority.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { captureSponsorAuthority } from "#infrastructure/acquisition-identity/sponsor.ts";
import { readMovieAttemptSponsor } from "#infrastructure/movie-editions/attempt-sponsor.ts";
import { acquisitionIdentity } from "#infrastructure/acquisition-identity/acquisition.ts";
import { retainedMovieCandidate } from "./candidate.test-support.ts";

const h = automationTestHarness();
const settings = {
  keepDays: 30,
  serverMachineId: "fixture-server",
  movieSectionId: "1",
};

async function fixture() {
  const db = h.database();
  const f = await h.fixture();
  await db.qualityProfileDefault.upsert({
    where: { kind: "movie" },
    create: { kind: "movie", profileId: f.profile.id },
    update: { profileId: f.profile.id },
  });
  const legacy = new PrismaMediaApplication(db, settings);
  const context = await legacy.getMovieEditionContext(
    f.user,
    f.media.id,
    f.user.id,
  );
  const option = context.options.find(
    (value) => value.edition === "extended_cut",
  );
  if (option === undefined)
    throw new Error("Missing registered edition option");
  const input = MovieRequestV4Schema.parse({
    schemaVersion: 4,
    mediaId: f.media.id,
    subjectUserId: f.user.id,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: option.targetVersion,
      definition: option.storedDefinition,
      request:
        option.request === null
          ? null
          : {
              id: option.request.id,
              version: option.request.version,
              choiceRevision: option.request.choiceRevision,
            },
    },
    selection: {
      edition: option.edition,
      definitionVersion: option.definitionVersion,
      definitionDigest: option.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages: ["en", "zh-Hans"] },
  });
  return {
    ...f,
    db,
    legacy,
    input,
    commands: new MovieLifecycleCommands(db, settings),
  };
}

test("v4 explicit choice atomically records named target, configured profile and edition-scoped outbox without changing unmarked intent", async () => {
  const f = await fixture();
  const original = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  const result = await f.commands.requestMovieEditionV4(
    f.user,
    crypto.randomUUID(),
    f.input,
  );
  expect(result).toMatchObject({
    schemaVersion: 4,
    edition: "extended_cut",
    state: "queued",
    reason: null,
  });
  if (result.operationId === null)
    throw new Error("V4 request omitted its operation");
  const request = await f.db.mediaRequest.findUniqueOrThrow({
    where: { id: result.requestId },
  });
  expect(request).toMatchObject({
    edition: "extended_cut",
    active: true,
    direct: true,
    movieEditionChoiceId: result.choiceId,
    subtitleLanguages: ["en", "zh-Hans"],
  });
  const intent = await f.db.mediaIntent.findUniqueOrThrow({
    where: {
      mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
    },
  });
  expect(intent).toMatchObject({
    editionRootId: f.media.id,
    monitoring: true,
    desiredPresence: true,
    profileId: f.profile.id,
    automationEpoch: 0,
  });
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: result.operationId },
    include: { outbox: true },
  });
  expect(operation).toMatchObject({
    kind: "reconcile_movie_edition_v4",
    targetId: f.media.id,
    payload: {
      schemaVersion: 4,
      scope: {
        rootMediaId: f.media.id,
        mediaId: f.media.id,
        edition: "extended_cut",
      },
      generation: intent.generation,
      requestId: request.id,
    },
  });
  expect(operation.outbox).not.toBeNull();
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toEqual(original);
});

test("v4 committed request replay precedes access refresh and preserves the original scoped command after cancellation", async () => {
  const f = await fixture();
  const key = crypto.randomUUID();
  const result = await f.commands.requestMovieEditionV4(f.user, key, f.input);
  if (result.operationId === null)
    throw new Error("V4 request omitted its operation");
  const operation = await f.db.operation.findUniqueOrThrow({
    where: { id: result.operationId },
  });
  await f.legacy.cancelMovieEditionRequest(f.user, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "cancel_request",
    subjectUserId: f.user.id,
    scope: {
      rootMediaId: f.media.id,
      mediaId: f.media.id,
      edition: "extended_cut",
    },
    requestId: result.requestId,
    expected: {
      targetVersion: result.applied.targetVersion,
      requestVersion: result.applied.requestVersion,
      choiceRevision: result.applied.choiceRevision,
    },
  });
  expect(
    await f.commands.requestMovieEditionV4(f.user, key, f.input, () =>
      Promise.reject(new Error("Committed replay must not refresh access")),
    ),
  ).toEqual(result);
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: result.operationId },
    }),
  ).toEqual(operation);
  expect(
    await f.db.operation.count({
      where: { targetId: f.media.id, kind: "reconcile_movie_edition_v4" },
    }),
  ).toBe(1);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: result.requestId },
    }),
  ).toMatchObject({ active: false, movieEditionChoiceId: null });
});

test("a stale v4 choice conflicts without creating its target or outbox", async () => {
  const f = await fixture();
  await f.db.mediaItem.update({
    where: { id: f.media.id },
    data: { version: { increment: 1 } },
  });
  await expect(
    f.commands.requestMovieEditionV4(f.user, crypto.randomUUID(), f.input),
  ).rejects.toMatchObject({ code: "version_conflict" });
  expect(
    await f.db.mediaIntent.count({
      where: { mediaId: f.media.id, edition: "extended_cut" },
    }),
  ).toBe(0);
  expect(
    await f.db.operation.count({
      where: { targetId: f.media.id, kind: "reconcile_movie_edition_v4" },
    }),
  ).toBe(0);
});

test("v4 choice produces immutable named attempt birth while legacy authority and another edition remain closed", async () => {
  const f = await fixture();
  const result = await f.commands.requestMovieEditionV4(
    f.user,
    crypto.randomUUID(),
    f.input,
  );
  if (result.operationId === null)
    throw new Error("V4 request omitted its operation");
  const operationId = result.operationId;
  const candidate = await retainedMovieCandidate(h.context(), f);
  const scope = MovieEditionScopeSchema.parse({
    rootMediaId: f.media.id,
    mediaId: f.media.id,
    edition: "extended_cut",
  });
  const attempt = await f.db.$transaction(async (tx) => {
    await lockMovieCommand(tx, scope);
    expect(await lockRuntimeAuthority(tx, 0)).toBe(true);
    const birth = await captureMovieChoiceV4(tx, {
      scope,
      sponsorRequestId: result.requestId,
      epoch: 0,
      access: settings,
    });
    const identity = await acquisitionIdentity(tx, candidate.release, {
      operationId,
      sponsorRequestId: result.requestId,
      epoch: 0,
      mediaIds: [f.media.id],
      serverMachineId: settings.serverMachineId,
      movieAccess: settings,
      movieScope: scope,
    });
    if (identity === null)
      throw new Error("V4 acquisition omitted canonical identity at birth");
    expect(identity.proof.kind).toBe("automatic");
    expect(
      await captureSponsorAuthority(tx, {
        operationId,
        sponsorRequestId: result.requestId,
        mediaIds: [f.media.id],
        serverMachineId: settings.serverMachineId,
        movieAccess: settings,
        movieScope: scope,
      }),
    ).toEqual({
      userId: f.user.id,
      actorId: f.user.id,
      serverMachineId: settings.serverMachineId,
    });
    birth.freshness.assertActive();
    return await tx.acquisitionAttempt.create({
      data: {
        edition: scope.edition,
        operationId,
        coordinatorOperationId: operationId,
        releaseId: candidate.release.id,
        sponsorRequestId: result.requestId,
        mediaIds: [f.media.id],
        generations: { [f.media.id]: birth.proof.targetGenerationAtCapture },
        movieEditionChoiceId: birth.proof.choiceId,
        movieEditionChoiceRevision: birth.proof.choiceRevision,
        movieEditionAuthority: birth.proof,
        identityEvidence: identity,
        recoveryEpoch: 0,
        state: "reserved",
      },
    });
  });
  const literalBirth = JSON.stringify(attempt.movieEditionAuthority);
  const identityInput = {
    operationId,
    sponsorRequestId: result.requestId,
    epoch: 0,
    mediaIds: [f.media.id],
    serverMachineId: settings.serverMachineId,
    movieAccess: settings,
    movieScope: scope,
  };
  await expect(
    acquisitionIdentity(f.db, candidate.release, {
      ...identityInput,
      movieScope: { ...scope, edition: "default" },
    }),
  ).rejects.toMatchObject({ code: "identity_scope_changed" });
  await expect(
    acquisitionIdentity(f.db, candidate.release, {
      ...identityInput,
      epoch: 1,
    }),
  ).rejects.toMatchObject({ code: "identity_scope_changed" });
  await expect(
    acquisitionIdentity(f.db, candidate.release, {
      ...identityInput,
      movieScope: undefined,
    }),
  ).rejects.toMatchObject({ code: "edition_candidate_incompatible" });
  await expect(
    captureSponsorAuthority(f.db, {
      operationId,
      sponsorRequestId: result.requestId,
      mediaIds: [f.media.id],
      serverMachineId: settings.serverMachineId,
      movieAccess: settings,
    }),
  ).rejects.toMatchObject({ code: "acquisition_sponsor_changed" });
  await expect(
    readMovieAttemptSponsor(f.db, {
      attemptId: attempt.id,
      expectedScope: { ...scope, edition: "default" },
      expectedRequestId: result.requestId,
    }),
  ).rejects.toThrow("another edition scope");
  await expect(
    readMovieAttemptSponsor(f.db, {
      attemptId: attempt.id,
      expectedScope: scope,
      expectedRequestId: crypto.randomUUID(),
    }),
  ).rejects.toThrow("another request");
  await f.db.$transaction(async (tx) => {
    const guard = await assertMovieChoiceV4(tx, {
      attemptId: attempt.id,
      scope,
      epoch: 0,
      access: settings,
    });
    guard.assertActive();
  });
  await expect(
    f.db.$transaction((tx) =>
      assertMovieAttemptChoice(tx, {
        attemptId: attempt.id,
        purpose: "new_acquisition_effect",
        access: settings,
      }),
    ),
  ).rejects.toMatchObject({ code: "movie_edition_choice_changed" });
  await expect(
    assertMovieChoiceV4(f.db, {
      attemptId: attempt.id,
      scope: { ...scope, edition: "directors_cut" },
      epoch: 0,
      access: settings,
    }),
  ).rejects.toThrow("immutable edition scope");
  const context = await f.legacy.getMovieEditionContext(
    f.user,
    f.media.id,
    f.user.id,
  );
  const option = context.options.find(
    (value) => value.edition === "extended_cut",
  );
  if (option?.request == null) throw new Error("V4 request disappeared");
  await f.commands.requestMovieEditionV4(f.user, crypto.randomUUID(), {
    ...f.input,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: option.targetVersion,
      definition: option.storedDefinition,
      request: {
        id: option.request.id,
        version: option.request.version,
        choiceRevision: option.request.choiceRevision,
      },
    },
  });
  await expect(
    assertMovieChoiceV4(f.db, {
      attemptId: attempt.id,
      scope,
      epoch: 0,
      access: settings,
    }),
  ).rejects.toMatchObject({ code: "movie_edition_choice_changed" });
  const retained = await f.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  expect(JSON.stringify(retained.movieEditionAuthority)).toBe(literalBirth);
  expect(retained.movieEditionChoiceId).toBe(attempt.movieEditionChoiceId);
});
