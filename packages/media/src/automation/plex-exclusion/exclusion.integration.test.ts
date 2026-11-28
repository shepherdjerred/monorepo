import { afterAll, beforeAll, expect, test } from "vitest";
import {
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import nodePath from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaPlexExclusionAdministration } from "#infrastructure/plex-exclusion-service.ts";
import { PlexMaintenanceClient } from "#integrations/plex-maintenance.ts";
import { runMediaTool } from "#filesystem/media-tools.ts";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { createPlexExclusionFileActivities } from "./files.ts";
import { createPlexExclusionNetworkActivities } from "./network.ts";
import {
  PLEX_EXCLUSION_PROOF_REQUIRED,
  PlexExclusionProofError,
  refreshPlexExclusionProofs,
  requirePlexExclusionProof,
} from "./proof.ts";
import type { PlexExclusionPlan } from "#shared/plex-exclusion.ts";
import { RunJournalSchema } from "./state.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let owner: MediaActor;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  owner = await cluster.database.mediaUser.create({
    data: { plexAccountId: "owner", displayName: "Owner", role: "owner" },
  });
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture(retainMetadata = false) {
  const db = cluster.database;
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "observe", version: { increment: 1 } },
  });
  const root = await realpath(
    await mkdtemp(nodePath.join(tmpdir(), "media-exclusion-pg-")),
  );
  directories.push(root);
  const service = new PrismaPlexExclusionAdministration(db, () =>
    Promise.resolve({ status: "COMPLETED", runId: "fixture-run" }),
  );
  let clock = Date.now();
  let scannedAt = 1;
  let visible = false;
  let scans = 0;
  let deletes = 0;
  let version = "1.43.4.10903-e5521bd8c";
  let plan: PlexExclusionPlan | null = null;
  const plex = new PlexMaintenanceClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "fixture",
    },
    async (url, init) => {
      if (url.pathname === "/identity")
        return Response.json({
          MediaContainer: { machineIdentifier: "machine", version },
        });
      if (url.pathname === "/library/sections")
        return Response.json({
          MediaContainer: {
            size: 1,
            Directory: [
              {
                key: "1",
                uuid: "section",
                type: "movie",
                scanner: "Plex Movie",
                agent: "tv.plex.agents.movie",
                scannedAt,
                refreshing: false,
                Location: [{ id: 1, path: root }],
              },
            ],
          },
        });
      if (url.pathname === "/activities")
        return Response.json({ MediaContainer: { size: 0 } });
      if (url.pathname.endsWith("/refresh")) {
        scans++;
        // Plex completes path-restricted scans without advancing the section's
        // scan watermark, even when those scans discover the positive probe.
        if (!url.searchParams.has("path")) scannedAt = Math.floor(clock / 1000);
        visible = scans === 1 || retainMetadata;
        return new Response(null, { headers: { "X-Plex-Activity": "scan" } });
      }
      if (init.method === "DELETE") {
        expect(url.pathname).toBe("/library/metadata/9");
        deletes++;
        visible = false;
        return new Response();
      }
      const item = {
        ratingKey: "9",
        title: "Synthetic probe",
        type: "movie",
        Media: [{ Part: [{ id: 1, file: plan?.positivePath ?? "invalid" }] }],
      };
      return Response.json({
        MediaContainer: {
          size: visible ? 1 : 0,
          totalSize: visible ? 1 : 0,
          Metadata: visible ? [item] : [],
        },
      });
    },
  );
  const network = createPlexExclusionNetworkActivities({
    db,
    plex,
    machineId: "machine",
    checkpoint: () => Promise.resolve(),
    permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
    now: () => new Date(clock),
  });
  const files = createPlexExclusionFileActivities({
    db,
    roots: { movies: root, tv: root },
    checkpoint: () => Promise.resolve(),
  });
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const prepared = await service.prepare(owner, crypto.randomUUID(), {
    kind: "movies",
    expectedRuntimeVersion: runtime.version,
  });
  const runId = prepared.runId;
  const operationId = prepared.operationId;
  if (runId === undefined || operationId === undefined)
    throw new Error("Prepare identity missing");
  await network.preparePlexExclusionTopology({ runId, operationId });
  await files.preparePlexExclusionFiles({ runId, operationId });
  const detail = await service.detail(owner, runId);
  plan = detail.plan;
  if (plan === null) throw new Error("Plan missing");
  return {
    root,
    db,
    service,
    plex,
    network,
    files,
    runId,
    detail,
    plan,
    setClock(value: string) {
      clock = Date.parse(value);
    },
    advance(milliseconds = 15_000) {
      clock = Math.max(clock + milliseconds, Date.now() + 1000);
    },
    resolveMetadata() {
      visible = false;
      clock = Date.now() + 1000;
    },
    counters: () => ({ scans, deletes }),
    changeVersion: () => {
      version = "changed";
    },
  };
}

test("owner-reviewed preparation executes real files, observes Plex cleanup, and survives same-epoch activation", async () => {
  const f = await fixture();
  expect(f.counters()).toEqual({ scans: 0, deletes: 0 });
  await expect(
    readFile(nodePath.join(f.root, ".plexignore")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await expect(
    f.service.execute(owner, crypto.randomUUID(), f.runId, {
      expectedVersion: f.detail.version,
      planDigest: "0".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "exclusion_conflict" });
  const approved = await f.service.execute(
    owner,
    crypto.randomUUID(),
    f.runId,
    { expectedVersion: f.detail.version, planDigest: f.detail.planDigest },
  );
  if (approved.operationId === undefined)
    throw new Error("Execution identity missing");
  const input = { runId: f.runId, operationId: approved.operationId };
  await f.network.validatePlexExclusionExecution(input);
  await f.files.stagePlexExclusionFiles(input);
  const stagedRun = await f.db.plexExclusionRun.findUniqueOrThrow({
    where: { id: f.runId },
  });
  const staged = RunJournalSchema.parse(stagedRun.journal).files?.stagedAt;
  if (staged == null) throw new Error("Missing staged time");
  f.setClock(staged);
  await expect(
    f.network.reconcilePlexExclusionScan({ ...input, cleanup: false }),
  ).resolves.toEqual({
    state: "waiting",
    reason: "awaiting_scan_timestamp_boundary",
  });
  expect(f.counters().scans).toBe(0);
  f.advance();
  await expect(
    f.network.reconcilePlexExclusionScan({ ...input, cleanup: false }),
  ).resolves.toMatchObject({ state: "waiting" });
  f.advance();
  await expect(
    f.network.reconcilePlexExclusionScan({ ...input, cleanup: false }),
  ).resolves.toMatchObject({ state: "verified" });
  await f.files.cleanupPlexExclusionFiles(input);
  f.advance();
  await expect(
    f.network.reconcilePlexExclusionScan({ ...input, cleanup: true }),
  ).resolves.toMatchObject({ state: "waiting" });
  f.advance();
  await expect(
    f.network.reconcilePlexExclusionScan({ ...input, cleanup: true }),
  ).resolves.toMatchObject({ state: "verified" });
  await f.network.finishPlexExclusion(input);
  expect(f.counters()).toEqual({ scans: 2, deletes: 0 });
  await expect(f.service.detail(owner, f.runId)).resolves.toMatchObject({
    state: "verified",
  });
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { mode: "active", version: { increment: 1 } },
  });
  const config = {
    machineId: "machine",
    movieSectionId: "1",
    tvSectionId: "2",
  };
  await refreshPlexExclusionProofs(f.db, f.plex, config);
  const roots = { library: f.root, control: `${f.root}/.media-control` };
  await expect(requirePlexExclusionProof(f.db, roots)).resolves.toBeUndefined();
  await writeFile(nodePath.join(f.root, ".plexignore"), "changed\n");
  await expect(requirePlexExclusionProof(f.db, roots)).rejects.toMatchObject({
    name: "FileGuardError",
    reason: PLEX_EXCLUSION_PROOF_REQUIRED,
    message: expect.stringContaining("markers changed"),
  });
  await writeFile(nodePath.join(f.root, ".plexignore"), f.plan.rootMarkerAfter);
  f.changeVersion();
  await refreshPlexExclusionProofs(f.db, f.plex, config);
  const missingProof = requirePlexExclusionProof(f.db, roots);
  await expect(missingProof).rejects.toBeInstanceOf(PlexExclusionProofError);
  await expect(missingProof).rejects.toMatchObject({
    name: "FileGuardError",
    reason: PLEX_EXCLUSION_PROOF_REQUIRED,
    message: expect.stringContaining("completed scanner proof"),
  });
}, 30_000);

test("epoch change after exact approval stops before probe or marker writes", async () => {
  const f = await fixture();
  const approved = await f.service.execute(
    owner,
    crypto.randomUUID(),
    f.runId,
    { expectedVersion: f.detail.version, planDigest: f.detail.planDigest },
  );
  if (approved.operationId === undefined)
    throw new Error("Execution identity missing");
  const input = { runId: f.runId, operationId: approved.operationId };
  await f.network.validatePlexExclusionExecution(input);
  await f.db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: { recoveryEpoch: { increment: 1 } },
  });
  await expect(f.files.stagePlexExclusionFiles(input)).rejects.toThrow(
    "authority changed",
  );
  expect(f.counters()).toEqual({ scans: 0, deletes: 0 });
  await expect(
    readFile(nodePath.join(f.root, ".plexignore")),
  ).rejects.toMatchObject({ code: "ENOENT" });
}, 30_000);

test("retained metadata exposes exact review and terminal same-run recovery never resends a scan or deletes media", async () => {
  const f = await fixture(true);
  const approved = await f.service.execute(
    owner,
    crypto.randomUUID(),
    f.runId,
    { expectedVersion: f.detail.version, planDigest: f.detail.planDigest },
  );
  if (approved.operationId === undefined) throw new Error("Execution missing");
  const input = { runId: f.runId, operationId: approved.operationId };
  await f.network.validatePlexExclusionExecution(input);
  await f.files.stagePlexExclusionFiles(input);
  f.advance();
  await f.network.reconcilePlexExclusionScan({ ...input, cleanup: false });
  f.advance();
  await f.network.reconcilePlexExclusionScan({ ...input, cleanup: false });
  await f.files.cleanupPlexExclusionFiles(input);
  f.advance();
  await f.network.reconcilePlexExclusionScan({ ...input, cleanup: true });
  f.advance(11 * 60_000);
  await expect(
    f.network.reconcilePlexExclusionScan({ ...input, cleanup: true }),
  ).resolves.toMatchObject({
    state: "intervention",
    reason: "probe_metadata_cleanup_required",
  });
  const detail = await f.service.detail(owner, f.runId);
  expect(detail.cleanupReview).toEqual({
    "9": { paths: [f.plan.positivePath], allPartsMatchProbes: true },
  });
  const command = {
    expectedVersion: detail.version,
    planDigest: detail.planDigest,
  };
  const busy = new PrismaPlexExclusionAdministration(f.db, () =>
    Promise.resolve({ status: "RUNNING", runId: "prior" }),
  );
  await expect(
    busy.recover(owner, crypto.randomUUID(), f.runId, command),
  ).rejects.toMatchObject({ code: "exclusion_busy" });
  f.resolveMetadata();
  const key = crypto.randomUUID();
  const recovered = await f.service.recover(owner, key, f.runId, command);
  await expect(busy.recover(owner, key, f.runId, command)).resolves.toEqual(
    recovered,
  );
  if (recovered.operationId === undefined) throw new Error("Recovery missing");
  const recoveryInput = { runId: f.runId, operationId: recovered.operationId };
  await f.network.validatePlexExclusionExecution(recoveryInput);
  await f.files.cleanupPlexExclusionFiles(recoveryInput);
  await f.network.reconcilePlexExclusionScan({
    ...recoveryInput,
    cleanup: true,
  });
  f.advance();
  await expect(
    f.network.reconcilePlexExclusionScan({ ...recoveryInput, cleanup: true }),
  ).resolves.toMatchObject({ state: "verified" });
  await f.network.finishPlexExclusion(recoveryInput);
  expect(f.counters()).toEqual({ scans: 2, deletes: 0 });
  await expect(f.service.detail(owner, f.runId)).resolves.toMatchObject({
    state: "verified",
  });
}, 30_000);

async function videoOnlyMovieBytes(): Promise<Uint8Array> {
  const dir = await realpath(
    await mkdtemp(nodePath.join(tmpdir(), "media-exclusion-video-")),
  );
  try {
    const out = nodePath.join(dir, "arrival.mkv");
    await runMediaTool(
      "ffmpeg",
      [
        "-nostdin",
        "-n",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=1920x1080:r=1:d=2",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=8000:cl=mono",
        "-t",
        "2",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-threads",
        "1",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-metadata:s:a:0",
        "language=eng",
        out,
      ],
      { maxBytes: 1024, timeoutMs: 30_000 },
    );
    return new Uint8Array(await readFile(out));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type WorkflowFixture = Awaited<ReturnType<typeof createMovieWorkflowFixture>>;

function createUpgradedExclusionPlex() {
  let clock = Date.now();
  let scannedAt = 1;
  let visible = false;
  let scans = 0;
  let activePlan: PlexExclusionPlan | null = null;
  const plex = new PlexMaintenanceClient(
    {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "fixture",
    },
    (url) => {
      if (url.pathname === "/identity")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              machineIdentifier: "fixture-server",
              version: "1.43.5.11079-b3b13e506",
            },
          }),
        );
      if (url.pathname === "/library/sections")
        return Promise.resolve(
          Response.json({
            MediaContainer: {
              size: 2,
              Directory: [
                {
                  key: "1",
                  uuid: "section-movie",
                  type: "movie",
                  scanner: "Plex Movie",
                  agent: "tv.plex.agents.movie",
                  scannedAt,
                  refreshing: false,
                  Location: [{ id: 1, path: "/data/movies" }],
                },
                {
                  key: "2",
                  uuid: "section-episode",
                  type: "show",
                  scanner: "Plex TV Series",
                  agent: "tv.plex.agents.series",
                  scannedAt,
                  refreshing: false,
                  Location: [{ id: 2, path: "/data/tv" }],
                },
              ],
            },
          }),
        );
      if (url.pathname === "/activities")
        return Promise.resolve(Response.json({ MediaContainer: { size: 0 } }));
      if (url.pathname.endsWith("/refresh")) {
        scans++;
        if (!url.searchParams.has("path")) scannedAt = Math.floor(clock / 1000);
        visible = scans === 1;
        return Promise.resolve(
          new Response(null, { headers: { "X-Plex-Activity": "scan" } }),
        );
      }
      const item = {
        ratingKey: "99",
        title: "Synthetic probe",
        type: "movie",
        Media: [
          { Part: [{ id: 1, file: activePlan?.positivePath ?? "invalid" }] },
        ],
      };
      return Promise.resolve(
        Response.json({
          MediaContainer: {
            size: visible ? 1 : 0,
            totalSize: visible ? 1 : 0,
            Metadata: visible ? [item] : [],
          },
        }),
      );
    },
  );
  return {
    plex,
    now: () => new Date(clock),
    setClock: (value: number) => {
      clock = value;
    },
    getClock: () => clock,
    setActivePlan: (plan: PlexExclusionPlan | null) => {
      activePlan = plan;
    },
  };
}

async function seedBlockedMovieAndTvReadiness(f: WorkflowFixture) {
  const { db } = f.source;
  const secondMovie = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Blocked Readiness Movie",
      year: 2021,
      tmdbId: 202_020,
      runtimeMinutes: 1,
      originalLanguage: "en",
    },
  });
  const secondMovieReq = await requestTestMovieV4(
    db,
    f.source.user,
    secondMovie.id,
    "default",
  );
  expect(
    await f.movie.reconcileMovieIntentV4(
      secondMovieReq.input,
      testPlexBindingExecution(),
    ),
  ).toEqual({
    status: "blocked",
    attemptId: null,
    reason: PLEX_EXCLUSION_PROOF_REQUIRED,
  });
  await f.finishMediaOperation({
    operationId: secondMovieReq.input.operationId,
    status: "reconciling",
    reason: PLEX_EXCLUSION_PROOF_REQUIRED,
  });
  const series = await db.mediaItem.create({
    data: { kind: "series", title: "Blocked Readiness Series" },
  });
  const episode = await db.mediaItem.create({
    data: {
      kind: "episode",
      parentId: series.id,
      seasonNumber: 1,
      episodeNumber: 1,
      title: "Pilot",
      externalIds: { plexRatingKey: "501", plexSectionId: "2" },
    },
  });
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(episode.id)], {
      createMissing: true,
    });
    await tx.mediaIntent.update({
      where: targetWhere(defaultScope(episode.id)),
      data: {
        generation: 1,
        profileId: f.source.profile.id,
        automationEpoch: 0,
        desiredPresence: true,
        monitoring: true,
      },
    });
  });
  await db.mediaRequest.create({
    data: { userId: f.source.user.id, mediaId: episode.id },
  });
  const tvOperationId = await serializable(db, (tx) =>
    queueOperation(tx, {
      key: `tv-readiness:${episode.id}`,
      kind: "reconcile_media",
      targetId: episode.id,
      payload: { mediaId: episode.id, generation: 1 },
    }),
  );
  const tvAcq = createAcquisitionActivities(f.source.context);
  expect(
    await tvAcq.reconcileMediaIntent({
      operationId: tvOperationId,
      mediaId: episode.id,
      generation: 1,
    }),
  ).toEqual({
    status: "blocked",
    attemptId: null,
    reason: PLEX_EXCLUSION_PROOF_REQUIRED,
  });
  await f.finishMediaOperation({
    operationId: tvOperationId,
    status: "reconciling",
    reason: PLEX_EXCLUSION_PROOF_REQUIRED,
  });
  return { secondMovie, secondMovieReq, episode, tvOperationId, tvAcq };
}

async function verifyMoviesExclusionInObserveMode(
  f: WorkflowFixture,
  ownerActor: MediaActor,
  harness: ReturnType<typeof createUpgradedExclusionPlex>,
) {
  const { db } = f.source;
  const runtimeBefore = await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: {
      mode: "observe",
      ownershipConfirmed: false,
      version: { increment: 1 },
    },
  });
  const exclusionService = new PrismaPlexExclusionAdministration(db, () =>
    Promise.resolve({ status: "COMPLETED", runId: "exclusion-closed" }),
  );
  const exclusionNetwork = createPlexExclusionNetworkActivities({
    db,
    plex: harness.plex,
    machineId: "fixture-server",
    checkpoint: () => Promise.resolve(),
    permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
    now: harness.now,
  });
  const exclusionFiles = createPlexExclusionFileActivities({
    db,
    roots: { movies: "/data/movies", tv: "/data/tv" },
    ...(f.fileContext.pathMapping === undefined
      ? {}
      : { pathMapping: f.fileContext.pathMapping }),
    checkpoint: () => Promise.resolve(),
  });
  const prepared = await exclusionService.prepare(
    ownerActor,
    crypto.randomUUID(),
    {
      kind: "movies",
      expectedRuntimeVersion: runtimeBefore.version,
    },
  );
  const runId = z.uuid().parse(prepared.runId);
  const prepOpId = z.uuid().parse(prepared.operationId);
  await exclusionNetwork.preparePlexExclusionTopology({
    runId,
    operationId: prepOpId,
  });
  await exclusionFiles.preparePlexExclusionFiles({
    runId,
    operationId: prepOpId,
  });
  const detail = await exclusionService.detail(ownerActor, runId);
  harness.setActivePlan(detail.plan);
  const executed = await exclusionService.execute(
    ownerActor,
    crypto.randomUUID(),
    runId,
    {
      expectedVersion: detail.version,
      planDigest: detail.planDigest,
    },
  );
  const execInput = {
    runId,
    operationId: z.uuid().parse(executed.operationId),
  };
  await exclusionNetwork.validatePlexExclusionExecution(execInput);
  await exclusionFiles.stagePlexExclusionFiles(execInput);
  harness.setClock(Math.max(harness.getClock() + 15_000, Date.now() + 1000));
  await exclusionNetwork.reconcilePlexExclusionScan({
    ...execInput,
    cleanup: false,
  });
  harness.setClock(Math.max(harness.getClock() + 15_000, Date.now() + 2000));
  await expect(
    exclusionNetwork.reconcilePlexExclusionScan({
      ...execInput,
      cleanup: false,
    }),
  ).resolves.toMatchObject({ state: "verified" });
  await exclusionFiles.cleanupPlexExclusionFiles(execInput);
  harness.setClock(Math.max(harness.getClock() + 15_000, Date.now() + 3000));
  await exclusionNetwork.reconcilePlexExclusionScan({
    ...execInput,
    cleanup: true,
  });
  harness.setClock(Math.max(harness.getClock() + 15_000, Date.now() + 4000));
  await expect(
    exclusionNetwork.reconcilePlexExclusionScan({
      ...execInput,
      cleanup: true,
    }),
  ).resolves.toMatchObject({ state: "verified" });
  harness.setClock(Date.now());
  await exclusionNetwork.finishPlexExclusion(execInput);
  return runId;
}

async function resumeAndPublishBlockedMovie(
  f: WorkflowFixture,
  sweepContext: WorkflowFixture["source"]["context"],
  attemptId: string,
) {
  const { db } = f.source;
  await createSweepActivities({
    ...sweepContext,
    movieManagement: {
      execution: testPlexBindingExecution(),
      budget: new PublicationAuthorityReadBudget(),
    },
  }).sweepMediaWork({
    kind: "downloads",
    cursor: "00000000-0000-0000-0000-000000000000",
    sweepId: "verified-proof-sweep",
  });
  const continuationOp = await db.operation.findFirstOrThrow({
    where: {
      idempotencyKey: { startsWith: `movie-retry-recover-v4:${attemptId}:` },
      status: "queued",
    },
    include: { outbox: true },
  });
  expect(continuationOp.outbox?.dispatchedAt).toBeNull();
  const continuationInput = MovieOperationV4Schema.parse(
    z.object(MovieOperationV4Schema.shape).parse(continuationOp.payload),
  );
  const resumedMovie = createMovieNetworkFacetV4(sweepContext);
  expect(
    await resumedMovie.reconcileMovieIntentV4(
      continuationInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({
    status: "acquire",
    attemptId,
    reason: "resume_prepared_movie_acquisition",
  });
  const resumedAttemptInput = {
    schemaVersion: 4 as const,
    operationId: continuationInput.operationId,
    attemptId,
    scope: f.input.scope,
  };
  expect(
    await f.movie.submitMovieTorrentV4(
      resumedAttemptInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await f.movie.observeMovieAcquisitionV4(
      resumedAttemptInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(
      resumedAttemptInput,
      testPublicationExecution(),
    ),
  ).toEqual({ status: "staged" });
  expect(
    await f.fileMovie.prepareMoviePublicationV4(
      resumedAttemptInput,
      testPublicationExecution(),
      new PublicationAuthorityReadBudget(),
    ),
  ).toEqual({ status: "prepared" });
  expect(
    await f.fileMovie.promoteMovieFilesV4(
      resumedAttemptInput,
      testPublicationExecution(),
    ),
  ).toEqual({ status: "published" });
  expect(
    await f.movie.publishMovieToPlexV4(
      resumedAttemptInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "available", reason: null });
  await f.movie.finalizeMovieAcquisitionV4(
    resumedAttemptInput,
    testPlexBindingExecution(),
  );
  return continuationInput.operationId;
}

test("revoked scanner proof blocks staging and new readiness, then resumes persisted validating movie plan without re-downloading after fresh proof", async () => {
  const f = await createMovieWorkflowFixture("default", {
    bytes: await videoOnlyMovieBytes(),
  });
  try {
    const { db } = f.source;
    const { ownerActor, attemptId, harness } =
      await acquireBlockedDefaultMovie(f);
    const initialEvidence = await f.evidence();
    expect(initialEvidence.adds).toBe(1);
    const blockedAttempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(blockedAttempt.state).toBe("validating");
    expect(blockedAttempt.filePlan).not.toBeNull();
    expect(await db.libraryAsset.count()).toBe(0);
    expect(await db.mediaPublicationTransition.count()).toBe(0);
    await expect(
      readdir(nodePath.join(f.fileContext.roots.movies.control, "staging")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await f.finishMediaOperation({
      operationId: f.input.operationId,
      status: "reconciling",
      reason: PLEX_EXCLUSION_PROOF_REQUIRED,
    });

    const readiness = await seedBlockedMovieAndTvReadiness(f);
    const sweepContext = {
      ...f.source.context,
      describeWorkflow: (id: string) =>
        Promise.resolve({
          status: "COMPLETED" as const,
          runId: `closed:${id}`,
        }),
    };
    await createSweepActivities({
      ...sweepContext,
      movieManagement: {
        execution: testPlexBindingExecution(),
        budget: new PublicationAuthorityReadBudget(),
      },
    }).sweepMediaWork({
      kind: "downloads",
      cursor: "00000000-0000-0000-0000-000000000000",
      sweepId: "revoked-proof-sweep",
    });
    expect(
      await db.operation.count({
        where: {
          idempotencyKey: {
            startsWith: `movie-retry-recover-v4:${attemptId}:`,
          },
        },
      }),
    ).toBe(0);

    const runId = await verifyMoviesExclusionInObserveMode(
      f,
      ownerActor,
      harness,
    );
    expect(
      await db.operation.findUnique({
        where: {
          idempotencyKey: `plex-exclusion-wake:${runId}:${readiness.secondMovieReq.input.operationId}`,
        },
        include: { outbox: true },
      }),
    ).toMatchObject({
      kind: "reconcile_movie_edition_v4",
      targetId: readiness.secondMovie.id,
      status: "queued",
      outbox: { dispatchedAt: null },
    });
    expect(
      await db.operation.findUnique({
        where: {
          idempotencyKey: `plex-exclusion-wake:${runId}:${readiness.tvOperationId}`,
        },
      }),
    ).toBeNull();

    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: {
        mode: "active",
        ownershipConfirmed: true,
        version: { increment: 1 },
      },
    });
    expect(
      await readiness.tvAcq.reconcileMediaIntent({
        operationId: readiness.tvOperationId,
        mediaId: readiness.episode.id,
        generation: 1,
      }),
    ).toEqual({
      status: "blocked",
      attemptId: null,
      reason: PLEX_EXCLUSION_PROOF_REQUIRED,
    });

    const continuationOperationId = await resumeAndPublishBlockedMovie(
      f,
      sweepContext,
      attemptId,
    );
    const after = await f.evidence();
    expect(after.adds).toBe(1);
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]).toMatchObject({
      id: attemptId,
      state: "completed",
      coordinatorOperationId: continuationOperationId,
      filePlan: blockedAttempt.filePlan,
    });
    expect(after.assets).toHaveLength(1);
    expect(after.assets[0]).toMatchObject({ state: "published", owned: true });
    expect(after.binding).toMatchObject({
      mediaId: f.input.mediaId,
      edition: "default",
    });
  } finally {
    await f.close();
  }
}, 60_000);

async function activateMoviesAfterExclusionProof(
  f: WorkflowFixture,
  ownerActor: MediaActor,
  harness: ReturnType<typeof createUpgradedExclusionPlex>,
) {
  const { db } = f.source;
  const runId = await verifyMoviesExclusionInObserveMode(
    f,
    ownerActor,
    harness,
  );
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: {
      mode: "active",
      ownershipConfirmed: true,
      version: { increment: 1 },
    },
  });
  return runId;
}

async function runDownloadsSweepForRetry(
  sweepContext: WorkflowFixture["source"]["context"],
  sweepId: string,
) {
  await createSweepActivities({
    ...sweepContext,
    movieManagement: {
      execution: testPlexBindingExecution(),
      budget: new PublicationAuthorityReadBudget(),
    },
  }).sweepMediaWork({
    kind: "downloads",
    cursor: "00000000-0000-0000-0000-000000000000",
    sweepId,
  });
}

async function acquireBlockedDefaultMovie(f: WorkflowFixture) {
  const { db } = f.source;
  const ownerUser = await db.mediaUser.findFirstOrThrow({
    where: { role: "owner" },
  });
  const ownerActor: MediaActor = { ...ownerUser, role: "owner" };
  const reserved = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(reserved.status).toBe("acquire");
  const attemptId = z.uuid().parse(reserved.attemptId);
  const attemptInput = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    attemptId,
    scope: f.input.scope,
  };
  expect(
    await f.movie.submitMovieTorrentV4(
      attemptInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await f.movie.observeMovieAcquisitionV4(
      attemptInput,
      testPlexBindingExecution(),
    ),
  ).toEqual({ status: "ready", reason: null });
  const harness = createUpgradedExclusionPlex();
  await refreshPlexExclusionProofs(db, harness.plex, {
    machineId: "fixture-server",
    movieSectionId: "1",
    tvSectionId: "2",
  });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(
      attemptInput,
      testPublicationExecution(),
    ),
  ).toEqual({ status: "blocked", reason: PLEX_EXCLUSION_PROOF_REQUIRED });
  return { ownerActor, attemptId, harness };
}

test("pre-renewal movie retry blocked by revoked exclusion proof recovers via a fresh sweep retry once proof is restored", async () => {
  const f = await createMovieWorkflowFixture("default", {
    bytes: await videoOnlyMovieBytes(),
  });
  try {
    const { db } = f.source;
    const { ownerActor, attemptId, harness } =
      await acquireBlockedDefaultMovie(f);
    await f.finishMediaOperation({
      operationId: f.input.operationId,
      status: "reconciling",
      reason: PLEX_EXCLUSION_PROOF_REQUIRED,
    });

    const sweepContext = {
      ...f.source.context,
      describeWorkflow: (id: string) =>
        Promise.resolve({
          status: "COMPLETED" as const,
          runId: `closed:${id}`,
        }),
    };

    await activateMoviesAfterExclusionProof(f, ownerActor, harness);
    await runDownloadsSweepForRetry(sweepContext, "queue-pre-renewal-retry");

    const firstRetryOp = await db.operation.findFirstOrThrow({
      where: {
        idempotencyKey: { startsWith: `movie-retry-recover-v4:${attemptId}:` },
      },
      include: { outbox: true },
    });
    await db.outboxCommand.update({
      where: { operationId: firstRetryOp.id },
      data: { dispatchedAt: new Date(), attempts: 1 },
    });

    // Revoke exclusion proof in the narrow window after queueing and before renewal.
    await db.plexExclusionProof.updateMany({
      where: { revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const firstRetryInput = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(firstRetryOp.payload),
    );
    expect(
      await createMovieNetworkFacetV4(sweepContext).reconcileMovieIntentV4(
        firstRetryInput,
        testPlexBindingExecution(),
      ),
    ).toEqual({
      status: "blocked",
      attemptId: null,
      reason: PLEX_EXCLUSION_PROOF_REQUIRED,
    });
    await f.finishMediaOperation({
      operationId: firstRetryOp.id,
      status: "reconciling",
      reason: PLEX_EXCLUSION_PROOF_REQUIRED,
    });

    const unrenewedAttempt = await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(unrenewedAttempt.coordinatorOperationId).toBe(f.input.operationId);

    // Sweep while proof remains revoked must not schedule another retry.
    await runDownloadsSweepForRetry(sweepContext, "still-revoked-sweep");
    expect(
      await db.operation.count({
        where: {
          idempotencyKey: {
            startsWith: `movie-retry-recover-v4:${attemptId}:`,
          },
        },
      }),
    ).toBe(1);

    // Restore proof: wake skips unrenewed retry payloads, then sweep schedules a fresh retry.
    await activateMoviesAfterExclusionProof(
      f,
      ownerActor,
      createUpgradedExclusionPlex(),
    );
    expect(
      await db.operation.findUniqueOrThrow({ where: { id: firstRetryOp.id } }),
    ).toMatchObject({ status: "reconciling" });

    const recoveredOperationId = await resumeAndPublishBlockedMovie(
      f,
      sweepContext,
      attemptId,
    );
    expect(recoveredOperationId).not.toBe(firstRetryOp.id);
    const firstRetryKey = z.string().parse(firstRetryOp.idempotencyKey);
    const recoveredOp = await db.operation.findUniqueOrThrow({
      where: { id: recoveredOperationId },
    });
    expect(recoveredOp.idempotencyKey).toBe(`${firstRetryKey}:blocked:1`);
    const supersededFirst = await db.operation.findUniqueOrThrow({
      where: { id: firstRetryOp.id },
    });
    expect(supersededFirst.status).toBe("completed");
    expect(supersededFirst.result).toMatchObject({
      reason: PLEX_EXCLUSION_PROOF_REQUIRED,
      supersededByOperationId: recoveredOperationId,
    });
  } finally {
    await f.close();
  }
}, 60_000);
