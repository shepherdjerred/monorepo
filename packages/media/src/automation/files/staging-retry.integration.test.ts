import { access, lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { automationTestHarness } from "#testing/automation.ts";
import { seasonPublicationFixture } from "#automation/publication-proof/season-fixture.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";

const h = automationTestHarness();
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

test("a fresh TV staging invocation retains the whole original plan and acknowledged partial, rechecks denial, then publishes once without probing again", async () => {
  const db = h.database();
  const f = await seasonPublicationFixture(db, 10);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const inspect = f.context.inspect;
  if (inspect === undefined) throw new Error("Actual fixture probe missing");
  const probe = vi.fn(inspect);
  f.context.inspect = probe;
  const originalCheckpoint = f.context.checkpoint;
  const at = Date.now();
  const clock = vi.spyOn(Date, "now");
  let expired = false;
  f.context.checkpoint = async (phase) => {
    await originalCheckpoint(phase);
    if (phase === "staging-prepared" && !expired) {
      expired = true;
      clock.mockReturnValue(at + 60_001);
    }
  };
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "blocked",
    reason: "publication_authority_expired",
  });
  expect(expired).toBe(true);
  clock.mockRestore();
  const retained = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const plan = FilePlanSchema.parse(retained.filePlan);
  expect(plan).toHaveLength(10);
  expect(probe).toHaveBeenCalledTimes(10);
  const first = plan[0];
  if (first === undefined) throw new Error("Original first descriptor missing");
  const partial = path.join(
    f.roots.control,
    `staging/${first.operationId}.partial`,
  );
  const before = await lstat(partial, { bigint: true });
  const journal = path.join(
    f.roots.control,
    `journal/${first.operationId}.json`,
  );
  const raw = await readFile(journal, "utf8");
  expect(JSON.parse(raw)).toMatchObject({
    phase: "prepared",
    preparedPartial: { identity: { inode: before.ino.toString() } },
  });
  await expect(
    access(path.join(f.roots.library, first.libraryPath)),
  ).rejects.toMatchObject({
    code: "ENOENT",
  });
  await db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    data: { desiredPresence: false },
  });
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "blocked",
    reason: "intent_obsolete",
  });
  expect(await readFile(journal, "utf8")).toBe(raw);
  const deniedPartial = await lstat(partial, { bigint: true });
  expect(deniedPartial.ino).toBe(before.ino);
  await db.mediaIntent.update({
    where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
    data: { desiredPresence: true },
  });
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  expect(probe).toHaveBeenCalledTimes(10);
  const staged = await lstat(
    path.join(f.roots.control, `staging/${first.operationId}`),
    { bigint: true },
  );
  expect(staged.ino).toBe(before.ino);
  expect(JSON.parse(await readFile(journal, "utf8"))).not.toHaveProperty(
    "preparedPartial",
  );
  const publicationAt = Date.now();
  const publicationClock = vi.spyOn(Date, "now");
  let publishedPrefix = false;
  f.context.checkpoint = async (phase) => {
    await originalCheckpoint(phase);
    if (
      phase === "publication-effect-ack:import_publish_link" &&
      !publishedPrefix
    ) {
      publishedPrefix = true;
      publicationClock.mockReturnValue(publicationAt + 60_001);
    }
  };
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "blocked",
    reason: "publication_authority_expired",
  });
  expect(publishedPrefix).toBe(true);
  publicationClock.mockRestore();
  const recorded = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: acquired.attempt.id },
  });
  expect(recorded.outcome).toBeNull();
  expect(await db.libraryAsset.count()).toBe(0);
  expect(await activities.promoteMediaFiles(acquired.input)).toEqual({
    status: "published",
  });
  const published = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  expect(identityHash(published.filePlan)).toBe(
    identityHash(retained.filePlan),
  );
  expect(published.identityEvidence).toEqual(retained.identityEvidence);
  expect(published.torrentId).toBe(acquired.attempt.torrentId);
  expect(await db.acquisitionAttempt.count()).toBe(1);
  expect(await db.torrent.count()).toBe(1);
  expect(await db.libraryAsset.count()).toBe(10);
  expect(await db.assetCoverage.count({ where: { current: true } })).toBe(10);
  expect(
    await db.mediaPublicationTransition.count({
      where: { attemptId: acquired.attempt.id },
    }),
  ).toBe(1);
  const committed = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: acquired.attempt.id },
  });
  expect(committed.intent).toEqual(recorded.intent);
  expect(committed.intentHash).toBe(recorded.intentHash);
  expect(committed.outcome).not.toBeNull();
}, 60_000);
