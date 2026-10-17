import { afterAll, expect, test } from "vitest";
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { automationTestHarness } from "#testing/automation.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { mappedPublicationFixture } from "./test-fixture.ts";

const harness = automationTestHarness();
const directories: string[] = [];
afterAll(async () => {
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

test("a real conflicting ACK append after the media syscall cannot commit an outcome or infer compensation", async () => {
  const db = harness.database();
  const f = await mappedPublicationFixture(db);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined || f.context.verifyPlexExclusion === undefined)
    throw new Error("Actual staged fixture missing");
  const canonical = path.join(
    f.context.roots.movies.library,
    entry.libraryPath,
  );
  let record: string | undefined;
  let collided = false;
  const verify = f.context.verifyPlexExclusion;
  f.context.checkpoint = async (phase) => {
    if (phase !== "publication-intent-committed") return;
    const intent = await db.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: acquired.attempt.id },
    });
    record = path.join(
      f.context.roots.movies.control,
      "publication-transitions",
      intent.id,
      "publication",
      "00000000.json",
    );
  };
  f.context.verifyPlexExclusion = async (roots) => {
    await verify(roots);
    if (record === undefined || collided) return;
    try {
      await stat(canonical);
    } catch (error) {
      if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
        return;
      throw error;
    }
    // External collision at the exact append boundary, after actual link but before ACK.
    await writeFile(record, "foreign durable record", { flag: "wx" });
    collided = true;
  };
  await expect(activities.promoteMediaFiles(acquired.input)).rejects.toThrow(
    "Publication effect record conflicts",
  );
  expect(collided).toBe(true);
  expect(await readFile(canonical, "utf8")).toBe(acquired.content);
  expect(await readFile(z.string().parse(record), "utf8")).toBe(
    "foreign durable record",
  );
  const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
    where: { attemptId: attempt.id },
  });
  expect(transition.outcome).toBeNull();
  expect(
    await db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    }),
  ).toEqual(attempt);
  expect(await db.libraryAsset.count({ where: { id: entry.assetId } })).toBe(0);
  expect(
    await db.acquisitionReservation.count({ where: { attemptId: attempt.id } }),
  ).toBe(1);
});
