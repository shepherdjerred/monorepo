import { afterEach, expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import {
  loadProfile,
  searchCandidates,
} from "#automation/acquisition-candidates.ts";
import { validAttempt } from "#automation/acquisition-submission.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import { grantTestRequesterAccess } from "#testing/authority.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

const harness = automationTestHarness();
const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
afterEach(() => vi.restoreAllMocks());

test("mapping expires during qBit's final observation and the actual add is never dispatched", async () => {
  const db = harness.database();
  const f = await harness.fixture("dispatch-expiry");
  let armed = false;
  let reached = false;
  let adds = 0;
  const clock = Date.now();
  const context = harness.context(async (url) => {
    if (url.pathname.endsWith("/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/info")) {
      const current = await db.acquisitionAttempt.findFirst({
        where: { mediaIds: { has: f.media.id }, state: "submitting" },
      });
      if (armed && current !== null) {
        reached = true;
        vi.spyOn(Date, "now").mockReturnValue(clock + 10_000);
      }
      return Response.json([]);
    }
    adds++;
    throw new Error("Unexpected add dispatch");
  });
  const activities = createAcquisitionActivities(context);
  const reserved = await activities.reconcileMediaIntent(f.input);
  if (reserved.attemptId === null)
    throw new Error("Actual chosen attempt missing");
  await db.plexIdentityMapping.update({
    where: { userId: f.user.id },
    data: { verifiedAt: new Date(clock - 295_000) },
  });
  const before = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: reserved.attemptId },
  });
  armed = true;
  expect(
    await activities.submitMediaTorrent({
      operationId: f.input.operationId,
      attemptId: before.id,
    }),
  ).toEqual({ status: "blocked", reason: "movie_edition_choice_changed" });
  expect(reached).toBe(true);
  expect(adds).toBe(0);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({ where: { id: before.id } }),
  ).toMatchObject({
    state: "reserved",
    torrentId: null,
    movieEditionAuthority: before.movieEditionAuthority,
  });
});

test("missing choice blocks direct search and selected-release reservation with no external calls", async () => {
  const f = await harness.fixture("missing-choice", {
    chooseMovieEdition: false,
  });
  const context = harness.context(); // Every external transport throws if touched.
  const profile = await loadProfile(harness.database(), f.media.id);
  if (profile === null) throw new Error("Fixture profile missing");
  await expect(
    searchCandidates(context, f.media.id, profile),
  ).rejects.toMatchObject({ code: "movie_edition_choice_required" });
  expect(
    await createAcquisitionActivities(context).reconcileMediaIntent(f.input),
  ).toEqual({
    status: "blocked",
    attemptId: null,
    reason: "movie_edition_choice_required",
  });
  expect(
    await harness
      .database()
      .acquisitionAttempt.count({ where: { mediaIds: { has: f.media.id } } }),
  ).toBe(0);
  expect(
    await harness
      .database()
      .acquisitionReservation.count({ where: { mediaId: f.media.id } }),
  ).toBe(0);
});

test.each([false, true])(
  "direct search rechecks actual choice after provider preparation (revoke=%s)",
  async (revoke) => {
    const db = harness.database();
    const f = await harness.fixture(`search-preparation-${String(revoke)}`);
    const context = harness.context();
    const profile = await loadProfile(db, f.media.id);
    if (profile === null) throw new Error("Missing actual search profile");
    let prepared = false;
    let searches = 0;
    context.providers = {
      withProvider: async (_id, work) => {
        prepared = true;
        if (revoke) {
          const app = new PrismaMediaApplication(db, {
            keepDays: 7,
            ...access,
          });
          const request = await db.mediaRequest.findUniqueOrThrow({
            where: {
              userId_mediaId_edition: {
                userId: f.user.id,
                mediaId: f.media.id,
                edition: "default",
              },
            },
          });
          const target = await db.mediaIntent.findUniqueOrThrow({
            where: {
              mediaId_edition: { mediaId: f.media.id, edition: "default" },
            },
          });
          await app.revokeMovieEditionChoice(
            { ...f.user, role: "member" },
            crypto.randomUUID(),
            {
              schemaVersion: 3,
              action: "revoke_choice",
              subjectUserId: f.user.id,
              scope: {
                rootMediaId: f.media.id,
                mediaId: f.media.id,
                edition: "default",
              },
              requestId: request.id,
              expected: {
                targetVersion: target.version,
                requestVersion: request.version,
                choiceRevision: request.movieEditionChoiceRevision,
              },
            },
          );
        }
        return work({
          search: () => {
            searches++;
            return Promise.resolve([]);
          },
          download: () =>
            Promise.reject(new Error("Unexpected provider download")),
        });
      },
    };
    if (revoke)
      await expect(
        searchCandidates(context, f.media.id, profile),
      ).rejects.toMatchObject({ code: "movie_edition_choice_required" });
    else
      expect(await searchCandidates(context, f.media.id, profile)).toEqual([]);
    expect(prepared).toBe(true);
    expect(searches).toBe(revoke ? 0 : 1);
    expect(
      await db.acquisitionAttempt.count({
        where: { mediaIds: { has: f.media.id } },
      }),
    ).toBe(0);
  },
);

test("a later explicit requester sponsors acquisition without erasing an older pending requester", async () => {
  const db = harness.database();
  const f = await harness.fixture("later-sponsor", {
    chooseMovieEdition: false,
  });
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Chosen requester",
    },
  });
  await grantTestRequesterAccess(db, user.id, access.serverMachineId);
  const chosen = await chooseTestMovieEdition(db, {
    actor: { ...user, role: "member" },
    mediaId: f.media.id,
    access,
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  const result = await createAcquisitionActivities(
    harness.context(),
  ).reconcileMediaIntent({ ...f.input, generation: target.generation });
  expect(result.status).toBe("acquire");
  if (result.attemptId === null) throw new Error("Chosen acquisition missing");
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: result.attemptId },
  });
  expect(attempt.sponsorRequestId).toBe(chosen.result.requestId);
  const pending = await db.mediaRequest.findUniqueOrThrow({
    where: {
      userId_mediaId_edition: {
        userId: f.user.id,
        mediaId: f.media.id,
        edition: "default",
      },
    },
  });
  expect(pending).toMatchObject({ active: true, movieEditionChoiceId: null });
});

test("actual Retry renews generations without changing birth choice and revoked Retry cannot renew again", async () => {
  const db = harness.database();
  const f = await harness.fixture("actual-retry");
  const context = harness.context();
  const result = await createAcquisitionActivities(
    context,
  ).reconcileMediaIntent(f.input);
  if (result.attemptId === null)
    throw new Error(`Fixture acquisition failed: ${String(result.reason)}`);
  const original = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: result.attemptId },
  });
  const app = new PrismaMediaApplication(db, { keepDays: 7, ...access });
  const actor = { ...f.user, role: "member" as const };
  const view = await app.getDefaultCommandContext(actor, f.media.id);
  await app.executeDefaultCommand(actor, crypto.randomUUID(), {
    schemaVersion: 2,
    scope: view.scope,
    expected: view.expected,
    command: { action: "retry" },
  });
  expect(await validAttempt(context, original.id)).toBe(true);
  const renewed = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: original.id },
  });
  expect(renewed.generations).not.toEqual(original.generations);
  expect(renewed.movieEditionAuthority).toEqual(original.movieEditionAuthority);
  expect(renewed.movieEditionChoiceId).toBe(original.movieEditionChoiceId);
  const request = await db.mediaRequest.findUniqueOrThrow({
    where: { id: renewed.sponsorRequestId ?? "" },
  });
  const target = await db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  await app.revokeMovieEditionChoice(actor, crypto.randomUUID(), {
    schemaVersion: 3,
    action: "revoke_choice",
    subjectUserId: actor.id,
    scope: { rootMediaId: f.media.id, mediaId: f.media.id, edition: "default" },
    requestId: request.id,
    expected: {
      targetVersion: target.version,
      requestVersion: request.version,
      choiceRevision: request.movieEditionChoiceRevision,
    },
  });
  await expect(validAttempt(context, original.id)).rejects.toMatchObject({
    code: "movie_edition_choice_changed",
  });
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: original.id },
    }),
  ).toMatchObject({
    generations: renewed.generations,
    movieEditionAuthority: original.movieEditionAuthority,
  });
});

test("choice revoked during actual provider preparation prevents the final qBittorrent add", async () => {
  const db = harness.database();
  const f = await harness.fixture("prepared-revocation");
  const source = {
    ...f.source,
    download: { kind: "torrent", value: "https://provider.fixture/download" },
  };
  await db.releaseCandidate.update({
    where: { id: f.release.id },
    data: {
      encryptedSource: harness.cipher.encrypt(
        JSON.stringify(source),
        `release:${source.providerId}:${source.providerReleaseId}`,
      ),
    },
  });
  let adds = 0;
  let prepared = false;
  const context = harness.context(async (url) => {
    if (url.pathname.endsWith("/login"))
      return new Response("Ok.", { headers: { "set-cookie": "SID=fixture" } });
    if (url.pathname.endsWith("/info")) return Response.json([]);
    adds++;
    throw new Error("Unexpected qBittorrent mutation");
  });
  const app = new PrismaMediaApplication(db, { keepDays: 7, ...access });
  context.providers = {
    withProvider: (_id, work) =>
      work({
        search: () => Promise.reject(new Error("Unexpected search")),
        download: async () => {
          prepared = true;
          const request = await db.mediaRequest.findUniqueOrThrow({
            where: {
              userId_mediaId_edition: {
                userId: f.user.id,
                mediaId: f.media.id,
                edition: "default",
              },
            },
          });
          const target = await db.mediaIntent.findUniqueOrThrow({
            where: {
              mediaId_edition: { mediaId: f.media.id, edition: "default" },
            },
          });
          await app.revokeMovieEditionChoice(
            { ...f.user, role: "member" },
            crypto.randomUUID(),
            {
              schemaVersion: 3,
              action: "revoke_choice",
              subjectUserId: f.user.id,
              scope: {
                rootMediaId: f.media.id,
                mediaId: f.media.id,
                edition: "default",
              },
              requestId: request.id,
              expected: {
                targetVersion: target.version,
                requestVersion: request.version,
                choiceRevision: request.movieEditionChoiceRevision,
              },
            },
          );
          return new Uint8Array([1, 2, 3]);
        },
      }),
  };
  const activities = createAcquisitionActivities(context);
  const reserved = await activities.reconcileMediaIntent(f.input);
  if (reserved.attemptId === null) throw new Error("Chosen attempt absent");
  const before = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: reserved.attemptId },
  });
  expect(
    await activities.submitMediaTorrent({
      operationId: f.input.operationId,
      attemptId: before.id,
    }),
  ).toEqual({ status: "blocked", reason: "movie_edition_choice_changed" });
  expect(prepared).toBe(true);
  expect(adds).toBe(0);
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({ where: { id: before.id } }),
  ).toMatchObject({
    state: "reserved",
    torrentId: null,
    movieEditionAuthority: before.movieEditionAuthority,
  });
});
