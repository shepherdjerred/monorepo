import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import nodePath from "node:path";
import { tmpdir } from "node:os";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import type { MediaActor } from "#application/auth.ts";
import { PrismaPlexExclusionAdministration } from "#infrastructure/plex-exclusion-service.ts";
import { PlexMaintenanceClient } from "#integrations/plex-maintenance.ts";
import { createPlexExclusionFileActivities } from "./files.ts";
import { createPlexExclusionNetworkActivities } from "./network.ts";
import {
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
        scannedAt = Math.floor(clock / 1000);
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
  await expect(requirePlexExclusionProof(f.db, roots)).rejects.toThrow(
    "markers changed",
  );
  await writeFile(nodePath.join(f.root, ".plexignore"), f.plan.rootMarkerAfter);
  f.changeVersion();
  await refreshPlexExclusionProofs(f.db, f.plex, config);
  await expect(requirePlexExclusionProof(f.db, roots)).rejects.toThrow(
    "completed scanner proof",
  );
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
