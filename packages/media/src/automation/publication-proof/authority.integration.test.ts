import { afterAll, beforeAll, expect, test } from "vitest";
import { access, rm } from "node:fs/promises";
import path from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { mappedPublicationFixture } from "./test-fixture.ts";
import { PrismaMediaCommands } from "#infrastructure/commands.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  if (cluster !== undefined) await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function stagedFixture() {
  const f = await mappedPublicationFixture(cluster.database);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(acquired.input)).toEqual({
    status: "staged",
  });
  const attempt = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: acquired.attempt.id },
  });
  return {
    ...f,
    acquired,
    activities,
    attempt,
    plan: FilePlanSchema.parse(attempt.filePlan),
  };
}

async function unpublished(f: Awaited<ReturnType<typeof stagedFixture>>) {
  expect(
    await cluster.database.libraryAsset.count({
      where: { coverage: { some: { mediaId: f.media.id } } },
    }),
  ).toBe(0);
  for (const entry of f.plan)
    await expect(
      access(path.join(f.roots.library, entry.libraryPath)),
    ).rejects.toThrow();
  const current = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.attempt.id },
  });
  expect(current.filePlan).toEqual(f.attempt.filePlan);
}

test.each(["generation", "claim"])(
  "a %s change committed between intent and effects cannot use earlier transaction authority",
  async (change) => {
    const db = cluster.database;
    const f = await stagedFixture();
    let changed = false;
    f.context.checkpoint = async (phase) => {
      if (phase !== "publication-intent-committed") return;
      const transition = await db.mediaPublicationTransition.findUniqueOrThrow({
        where: { attemptId: f.attempt.id },
      });
      expect(transition.outcome).toBeNull();
      if (change === "claim") {
        const request = await db.mediaRequest.findUniqueOrThrow({
          where: { id: f.request.id },
        });
        await new PrismaMediaCommands(db, { keepDays: 30 }).cancelRequest(
          { ...f.user, role: "member" },
          crypto.randomUUID(),
          request.id,
          request.version,
        );
      } else
        await db.$transaction(async (tx) => {
          await lockDefaultScopes(tx, [defaultScope(f.media.id)], {
            createMissing: false,
          });
          await tx.mediaIntent.update({
            where: targetWhere(defaultScope(f.media.id)),
            data: { generation: { increment: 1 } },
          });
        });
      changed = true;
    };
    expect(await f.activities.promoteMediaFiles(f.acquired.input)).toEqual(
      change === "generation"
        ? { status: "obsolete", reason: "intent_obsolete" }
        : { status: "blocked", reason: "movie_edition_choice_changed" },
    );
    expect(changed).toBe(true);
    await unpublished(f);
  },
);

test("invocation expiry after effect-transaction authority still prevents the first syscall", async () => {
  const f = await stagedFixture();
  let deadline = Date.now() + 60_000;
  let intentCommitted = false;
  let authorizations = 0;
  f.context.publicationExecution = () => ({
    signal: new AbortController().signal,
    checkpoint: () => Promise.resolve(),
    assertActive: () => {
      if (Date.now() >= deadline)
        throw new Error("Test publication deadline expired");
    },
  });
  f.context.checkpoint = (phase) => {
    if (phase === "publication-intent-committed") intentCommitted = true;
    if (intentCommitted && phase === "publication-authorization") {
      authorizations += 1;
      // The plan authority completed under the second transaction's locks;
      // expiry arrives at its per-entry boundary before any filesystem effect.
      if (authorizations === 2) deadline = Date.now() - 1;
    }
    return Promise.resolve();
  };
  await expect(
    f.activities.promoteMediaFiles(f.acquired.input),
  ).rejects.toThrow("Test publication deadline expired");
  expect(authorizations).toBe(2);
  const transition =
    await cluster.database.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.attempt.id },
    });
  expect(transition.outcome).toBeNull();
  await unpublished(f);
});
