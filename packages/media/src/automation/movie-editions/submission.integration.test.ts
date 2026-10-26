import { afterEach, expect, test, vi } from "vitest";
import { setTimeout } from "node:timers/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import type { FetchTransport } from "#integrations/http.ts";
import { retainedMovieCandidate } from "#infrastructure/movie-editions/lifecycle/candidate.test-support.ts";
import { storeMovieCandidateV4 } from "./candidates.ts";
import { reserveMovieCandidateV4 } from "./reservation.ts";
import { submitMovieTorrentV4 } from "./submission.ts";
import { observeMovieAcquisitionV4 } from "./observation.ts";
import { QualityRulesSchema } from "#shared/api.ts";

const h = automationTestHarness();
afterEach(() => vi.restoreAllMocks());

function qbitWire() {
  const state: {
    adds: number;
    lookups: number;
    calls: string[];
    visible: boolean;
    loseReply: boolean;
    torrent: Record<string, unknown> | null;
    beforeInfo: (index: number) => Promise<void>;
    beforeAdd: () => Promise<void>;
  } = {
    adds: 0,
    lookups: 0,
    calls: [],
    visible: true,
    loseReply: false,
    torrent: null,
    beforeInfo: (_index: number) => Promise.resolve(),
    beforeAdd: () => Promise.resolve(),
  };
  const transport: FetchTransport = async (url, init) => {
    state.calls.push(url.pathname);
    if (url.pathname.endsWith("/auth/login"))
      return new Response("Ok.", {
        headers: { "Set-Cookie": "SID=fixture; HttpOnly" },
      });
    if (url.pathname.endsWith("/torrents/info")) {
      await state.beforeInfo(++state.lookups);
      return Response.json(
        state.torrent === null || !state.visible ? [] : [state.torrent],
      );
    }
    if (url.pathname.endsWith("/torrents/files"))
      return Response.json([
        {
          index: 0,
          name: "Example.2020.EXTENDED.mkv",
          size: 1000,
          progress: 1,
          priority: 1,
        },
      ]);
    if (url.pathname.endsWith("/torrents/add")) {
      state.adds++;
      if (!(init.body instanceof URLSearchParams))
        throw new TypeError("Actual qBit client did not emit its magnet form");
      const hash = new URL(init.body.get("urls") ?? "").searchParams
        .get("xt")
        ?.replace("urn:btih:", "");
      if (hash === undefined)
        throw new Error("Actual qBit form lost its source hash");
      expect(Object.fromEntries(init.body)).toMatchObject({
        autoTMM: "false",
        ratioLimit: "-1",
        seedingTimeLimit: "-1",
        inactiveSeedingTimeLimit: "-1",
        shareLimitAction: "Stop",
      });
      await state.beforeAdd();
      state.torrent = {
        hash,
        infohash_v1: hash,
        infohash_v2: "",
        tags: init.body.get("tags"),
        save_path: init.body.get("savepath"),
        content_path: `${String(init.body.get("savepath"))}/Example.2020.EXTENDED.mkv`,
        name: "fixture",
        state: "downloading",
        category: "media",
        progress: 0,
        ratio: 0,
        seeding_time: 0,
        size: 1000,
        ratio_limit: -1,
        seeding_time_limit: -1,
        inactive_seeding_time_limit: -1,
        max_ratio: -1,
        max_seeding_time: -1,
        max_inactive_seeding_time: -1,
        share_limit_action: "Stop",
        auto_tmm: false,
        force_start: false,
      };
      if (state.loseReply) return new Response("", { status: 503 });
      return Response.json({
        added_torrent_ids: [hash],
        success_count: 1,
        failure_count: 0,
        pending_count: 0,
      });
    }
    throw new Error(`Unexpected synthetic qBit route: ${url.pathname}`);
  };
  return { state, transport };
}

async function fixture() {
  const f = await h.fixture();
  const db = h.database();
  await db.qualityProfileDefault.upsert({
    where: { kind: "movie" },
    create: { kind: "movie", profileId: f.profile.id },
    update: { profileId: f.profile.id },
  });
  const request = await requestTestMovieV4(
    db,
    f.user,
    f.media.id,
    "extended_cut",
  );
  const candidate = await retainedMovieCandidate(h.context(), f);
  const wire = qbitWire();
  const context = h.context(wire.transport);
  const selected = await storeMovieCandidateV4(
    context,
    request.input.scope,
    candidate.source,
  );
  if (selected === null)
    throw new Error("Actual named source did not satisfy scoped policy");
  const attemptId = await reserveMovieCandidateV4(
    context,
    request.input,
    selected,
    0,
  );
  if (attemptId === null)
    throw new Error("Actual v4 movie reservation was denied");
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  const input = {
    schemaVersion: 4 as const,
    operationId: request.input.operationId,
    attemptId,
    scope: request.input.scope,
  };
  const cancel = () =>
    request.commands.cancelMovieEditionRequest(f.user, crypto.randomUUID(), {
      schemaVersion: 3,
      action: "cancel_request",
      subjectUserId: f.user.id,
      scope: input.scope,
      requestId: request.result.requestId,
      expected: {
        targetVersion: request.result.applied.targetVersion,
        requestVersion: request.result.applied.requestVersion,
        choiceRevision: request.result.applied.choiceRevision,
      },
    });
  return {
    ...f,
    ...request,
    db,
    candidate,
    context,
    wire,
    attempt,
    input,
    cancel,
  };
}

test("v4 submits a named movie through the actual qBit client and records scoped acquisition plus independent seeding exactly once", async () => {
  const f = await fixture();
  const defaultBefore = await f.db.mediaIntent.findUniqueOrThrow({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
  });
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(f.wire.state.adds).toBe(1);
  const torrent = await f.db.torrent.findUniqueOrThrow({
    where: { infoHash: f.candidate.source.infoHash },
  });
  expect(torrent).toMatchObject({
    owned: true,
    providerId: "knaben",
    ownershipEpoch: 0,
    seedingPolicy: { kind: "public" },
  });
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({
    state: "downloading",
    torrentId: torrent.id,
    edition: "extended_cut",
    identityEvidence: f.attempt.identityEvidence,
    movieEditionAuthority: f.attempt.movieEditionAuthority,
  });
  expect(
    await f.db.operation.count({
      where: { idempotencyKey: `seed:${torrent.id}` },
    }),
  ).toBe(1);
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: {
        mediaId_edition: { mediaId: f.media.id, edition: "extended_cut" },
      },
    }),
  ).toMatchObject({ availability: "downloading" });
  expect(
    await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    }),
  ).toEqual(defaultBefore);
});

test("wrong scope, coordinator and revoked intent cannot dispatch a v4 torrent add", async () => {
  const f = await fixture();
  await expect(
    submitMovieTorrentV4(f.context, {
      ...f.input,
      scope: { ...f.input.scope, edition: "default" },
    }),
  ).rejects.toThrow("immutable attempt scope");
  expect(
    await submitMovieTorrentV4(f.context, {
      ...f.input,
      operationId: crypto.randomUUID(),
    }),
  ).toEqual({ status: "obsolete", reason: "coordinator_changed" });
  await f.cancel();
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "obsolete",
    reason: "intent_changed",
  });
  expect(f.wire.state.calls).toEqual([]);
  expect(f.wire.state.adds).toBe(0);
  expect(
    await f.db.torrent.count({
      where: { infoHash: f.candidate.source.infoHash },
    }),
  ).toBe(0);
});

test("choice cancellation during qBit lookup is rechecked under locks before the actual add", async () => {
  const f = await fixture();
  f.wire.state.beforeInfo = async (index) => {
    if (index === 1) await f.cancel();
  };
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "blocked",
    reason: "submission_authority_changed",
  });
  expect(f.wire.state.adds).toBe(0);
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({
    state: "reserved",
    torrentId: null,
    movieEditionAuthority: f.attempt.movieEditionAuthority,
  });
});

test("cancellation waits behind the final authorization and add, and a proven prior add keeps its seeding obligation", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  f.wire.state.beforeAdd = async () => {
    entered.resolve(undefined);
    await release.promise;
  };
  const submitted = submitMovieTorrentV4(f.context, f.input);
  await entered.promise;
  let cancelled = false;
  const cancel = async () => {
    await f.cancel();
    cancelled = true;
  };
  const cancellation = cancel();
  try {
    await setTimeout(20);
    expect(cancelled).toBe(false);
  } finally {
    release.resolve(undefined);
  }
  await Promise.all([submitted, cancellation]);
  expect(f.wire.state.adds).toBe(1);
  const torrent = await f.db.torrent.findUniqueOrThrow({
    where: { infoHash: f.candidate.source.infoHash },
  });
  expect(
    await f.db.operation.count({
      where: { idempotencyKey: `seed:${torrent.id}` },
    }),
  ).toBe(1);
  expect(
    await f.db.mediaRequest.findUniqueOrThrow({
      where: { id: f.result.requestId },
    }),
  ).toMatchObject({ active: false });
});

test("lost add reply is observed after cancellation without a second add, preserving literal birth and independent seeding", async () => {
  const f = await fixture();
  f.wire.state.loseReply = true;
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "blocked",
    reason: "outcome-unknown",
  });
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({ state: "submission_unknown", torrentId: null });
  await f.cancel();
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(f.wire.state.adds).toBe(1);
  const torrent = await f.db.torrent.findUniqueOrThrow({
    where: { infoHash: f.candidate.source.infoHash },
  });
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({
    state: "cancelled",
    torrentId: torrent.id,
    movieEditionAuthority: f.attempt.movieEditionAuthority,
    identityEvidence: f.attempt.identityEvidence,
  });
  expect(
    await f.db.operation.count({
      where: { idempotencyKey: `seed:${torrent.id}` },
    }),
  ).toBe(1);
});

test("an uncertain absent torrent is protected and never blindly submitted again", async () => {
  const f = await fixture();
  f.wire.state.loseReply = true;
  expect(await submitMovieTorrentV4(f.context, f.input)).toMatchObject({
    status: "blocked",
    reason: "outcome-unknown",
  });
  f.wire.state.visible = false;
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "blocked",
    reason: "submission_outcome_unknown",
  });
  expect(f.wire.state.adds).toBe(1);
  expect(
    await f.db.torrent.count({
      where: { infoHash: f.candidate.source.infoHash },
    }),
  ).toBe(0);
});

test("original mapping expiry during the client's final observation prevents the actual add without renewing consent", async () => {
  const f = await fixture();
  const clock = Date.now();
  await f.db.plexIdentityMapping.update({
    where: { userId: f.user.id },
    data: { verifiedAt: new Date(clock - 295_000) },
  });
  f.wire.state.beforeInfo = (index) => {
    if (index === 2) vi.spyOn(Date, "now").mockReturnValue(clock + 10_000);
    return Promise.resolve();
  };
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "blocked",
    reason: "movie_edition_choice_changed",
  });
  expect(f.wire.state.adds).toBe(0);
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({
    state: "reserved",
    torrentId: null,
    movieEditionAuthority: f.attempt.movieEditionAuthority,
  });
});

test("feature gate, original profile version and recovery epoch block new transfer before any qBit request", async () => {
  const f = await fixture();
  f.context.gates.acquisition = () => Promise.resolve(false);
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "blocked",
    reason: "acquisition_disabled",
  });
  f.context.gates.acquisition = () => Promise.resolve(true);
  const rules = QualityRulesSchema.parse(f.profile.rules);
  await f.db.qualityProfileVersion.create({
    data: { profileId: f.profile.id, version: 1, rules },
  });
  await f.db.qualityProfile.update({
    where: { id: f.profile.id },
    data: { version: 1, rules },
  });
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "obsolete",
    reason: "intent_changed",
  });
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: 1 },
  });
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "blocked",
    reason: "recovery_epoch_changed",
  });
  expect(f.wire.state.calls).toEqual([]);
  expect(f.wire.state.adds).toBe(0);
});

test("the original writer lease expiry is rechecked immediately before qBit mutation", async () => {
  const f = await fixture();
  const lease = await f.db.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const expired = lease.expiresAt.getTime() + 1;
  f.wire.state.beforeInfo = (index) => {
    if (index === 2) vi.spyOn(Date, "now").mockReturnValue(expired);
    return Promise.resolve();
  };
  await expect(submitMovieTorrentV4(f.context, f.input)).rejects.toMatchObject({
    code: "submission_authority_expired",
  });
  expect(f.wire.state.adds).toBe(0);
  expect(
    await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.attempt.id },
    }),
  ).toMatchObject({
    state: "submission_unknown",
    torrentId: null,
    movieEditionAuthority: f.attempt.movieEditionAuthority,
  });
  expect(
    await f.db.legacyWriterLease.findUniqueOrThrow({
      where: { id: "singleton" },
    }),
  ).toEqual(lease);
});

test("observation validates original ownership and scope before recording complete torrent members", async () => {
  const f = await fixture();
  expect(await submitMovieTorrentV4(f.context, f.input)).toEqual({
    status: "submitted",
    reason: null,
  });
  expect(await observeMovieAcquisitionV4(f.context, f.input)).toEqual({
    status: "downloading",
    reason: null,
  });
  if (f.wire.state.torrent === null)
    throw new Error("Actual client did not submit its torrent");
  f.wire.state.torrent["progress"] = 1;
  expect(await observeMovieAcquisitionV4(f.context, f.input)).toEqual({
    status: "ready",
    reason: null,
  });
  const torrent = await f.db.torrent.findUniqueOrThrow({
    where: { infoHash: f.candidate.source.infoHash },
  });
  expect(torrent).toMatchObject({
    state: "seeding",
    observation: {
      files: [
        {
          index: 0,
          name: "Example.2020.EXTENDED.mkv",
          size: 1000,
          progress: 1,
        },
      ],
    },
  });
  f.wire.state.torrent["tags"] = "another-owner";
  expect(await observeMovieAcquisitionV4(f.context, f.input)).toEqual({
    status: "blocked",
    reason: "torrent_ownership_conflict",
  });
  expect(
    await f.db.torrent.findUniqueOrThrow({ where: { id: torrent.id } }),
  ).toEqual(torrent);
  await expect(
    observeMovieAcquisitionV4(f.context, {
      ...f.input,
      scope: { ...f.input.scope, edition: "directors_cut" },
    }),
  ).rejects.toThrow("immutable attempt scope");
});
