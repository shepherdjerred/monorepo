import { afterAll, beforeAll, expect, test } from "vitest";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { seasonPublicationFixture } from "#automation/publication-proof/season-fixture.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
let fixture: Awaited<ReturnType<typeof seasonPublicationFixture>>;
let acquired: Awaited<ReturnType<typeof fixture.acquisition>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
  fixture = await seasonPublicationFixture(cluster.database, 100);
  acquired = await fixture.acquisition();
  // Real probing, outside-PG copy/hash and the whole-plan authorized commit.
  expect(
    await createMediaFileActivities(fixture.context).inspectAndStageMedia(
      acquired.input,
    ),
  ).toEqual({ status: "staged" });
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
  if (fixture !== undefined)
    await rm(fixture.directory, { recursive: true, force: true });
});

test("the supported 100-file, 100-leaf TV bound stages exact original journals with no publication or choice grant", async () => {
  const db = cluster.database;
  const attempt = await db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  const plan = FilePlanSchema.parse(attempt.filePlan);
  expect(plan).toHaveLength(100);
  expect(plan.flatMap((entry) => entry.mediaIds).toSorted()).toEqual(
    fixture.mediaIds.toSorted(),
  );
  expect(new Set(plan.flatMap((entry) => entry.mediaIds)).size).toBe(100);
  expect(attempt).toMatchObject({
    movieEditionChoiceId: null,
    movieEditionChoiceRevision: null,
    movieEditionAuthority: null,
  });
  expect(
    await db.mediaPublicationTransition.count({
      where: { attemptId: attempt.id },
    }),
  ).toBe(0);
  expect(
    await db.libraryAsset.count({
      where: { coverage: { some: { mediaId: { in: fixture.mediaIds } } } },
    }),
  ).toBe(0);
  for (const entry of plan) {
    const source = acquired.files.find(
      (file) => file.name === entry.downloadPath,
    );
    if (source === undefined) throw new Error("Unmatched actual source file");
    expect(
      await readFile(
        path.join(fixture.roots.control, `staging/${entry.operationId}`),
        "utf8",
      ),
    ).toBe(source.content);
    const raw = await readFile(
      path.join(fixture.roots.control, `journal/${entry.operationId}.json`),
      "utf8",
    );
    expect(ManifestSchema.parse(JSON.parse(raw))).toMatchObject({
      version: 1,
      operationId: entry.operationId,
      kind: "import",
      phase: "staged",
      sha256: entry.checksum,
    });
    await expect(
      access(path.join(fixture.roots.library, entry.libraryPath)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }
});
