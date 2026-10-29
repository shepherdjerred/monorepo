import { afterAll, beforeAll, expect, it } from "vitest";
import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import { createMediaFileActivities } from "#automation/files/activities.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { FilePlanSchema } from "#automation/files/types.ts";
import { PublicationOutcomeSchema } from "#shared/publication-proof/outcome.ts";
import { validAttempt } from "#automation/acquisition-submission.ts";
import { QualityRulesSchema } from "#shared/api.ts";

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

it("a revoked choice compensates an actual durable publication ACK on a fresh inspection invocation", async () => {
  const f = await fixture();
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(f.acquired.input)).toEqual({
    status: "staged",
  });
  const attempt = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.acquired.attempt.id },
  });
  const entry = FilePlanSchema.parse(attempt.filePlan)[0];
  if (entry === undefined) throw new Error("Staged plan missing");
  let acknowledged = false;
  f.context.checkpoint = (phase) => {
    if (phase === "publication-effect-ack:import_publish_link") {
      acknowledged = true;
      throw new Error("Injected interruption after durable ACK");
    }
    return Promise.resolve();
  };
  await expect(activities.promoteMediaFiles(f.acquired.input)).rejects.toThrow(
    "Injected interruption after durable ACK",
  );
  expect(acknowledged).toBe(true);
  expect(
    await readFile(path.join(f.roots.library, entry.libraryPath), "utf8"),
  ).toBe(f.acquired.content);
  const prefix =
    await cluster.database.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: attempt.id },
    });
  expect(prefix.outcome).toBeNull();
  f.context.checkpoint = () => Promise.resolve();
  await f.revoke();
  expect(
    await createMediaFileActivities(f.context).inspectAndStageMedia(
      f.acquired.input,
    ),
  ).toEqual({ status: "blocked", reason: "movie_edition_choice_changed" });
  const settled =
    await cluster.database.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: prefix.id },
    });
  expect(settled.intent).toEqual(prefix.intent);
  expect(settled.intentHash).toBe(prefix.intentHash);
  expect(PublicationOutcomeSchema.parse(settled.outcome).kind).toBe(
    "compensated",
  );
  await expect(
    access(path.join(f.roots.library, entry.libraryPath)),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await readFile(
      path.join(f.roots.control, `staging/${entry.operationId}`),
      "utf8",
    ),
  ).toBe(f.acquired.content);
  expect(
    await cluster.database.libraryAsset.count({ where: { id: entry.assetId } }),
  ).toBe(0);
  const current = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  expect(current.movieEditionAuthority).toEqual(attempt.movieEditionAuthority);
});

it("committed publication readback survives later choice revocation without renewed authority", async () => {
  const f = await fixture();
  await cluster.database.qualityProfileVersion.create({
    data: {
      profileId: f.profile.id,
      version: f.profile.version,
      rules: QualityRulesSchema.parse(f.profile.rules),
    },
  });
  const activities = createMediaFileActivities(f.context);
  expect(await activities.inspectAndStageMedia(f.acquired.input)).toEqual({
    status: "staged",
  });
  expect(await activities.promoteMediaFiles(f.acquired.input)).toEqual({
    status: "published",
  });
  const transition =
    await cluster.database.mediaPublicationTransition.findUniqueOrThrow({
      where: { attemptId: f.acquired.attempt.id },
    });
  const attempt = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: f.acquired.attempt.id },
  });
  await f.revoke();
  // Current movie configuration is intentionally unavailable: strict committed readback precedes it.
  f.context.permittedMovieSection = () =>
    Promise.reject(new Error("Readback tried fresh choice configuration"));
  expect(
    await validAttempt(
      {
        db: cluster.database,
        serverMachineId: "fixture-server",
        permittedSections: () =>
          Promise.reject(
            new Error("Readback tried fresh choice configuration"),
          ),
      },
      attempt.id,
    ),
  ).toBe(true);
  const adopted = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  expect(adopted.movieEditionAuthority).toEqual(attempt.movieEditionAuthority);
  expect(adopted.filePlan).toEqual(attempt.filePlan);
  expect(
    await createMediaFileActivities(f.context).promoteMediaFiles(
      f.acquired.input,
    ),
  ).toEqual({ status: "published" });
  expect(
    await cluster.database.mediaPublicationTransition.findUniqueOrThrow({
      where: { id: transition.id },
    }),
  ).toEqual(transition);
  expect(
    await cluster.database.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    }),
  ).toEqual(adopted);
});
async function fixture() {
  const f = await fileFixture(cluster.database);
  directories.push(f.directory);
  const acquired = await f.acquisition();
  const app = new PrismaMediaApplication(cluster.database, {
    keepDays: 7,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  });
  async function revoke() {
    const request = await cluster.database.mediaRequest.findUniqueOrThrow({
      where: { id: f.request.id },
    });
    const target = await cluster.database.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.media.id, edition: "default" } },
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
  return { ...f, acquired, revoke };
}

it.each(["before", "copying", "staging-prepared"])(
  "choice revoke at %s prevents accepted staging and preserves birth proof",
  async (phase) => {
    const f = await fixture();
    const before = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.acquired.attempt.id },
    });
    let reached = false;
    let copies = 0;
    if (phase === "before") {
      await f.revoke();
      reached = true;
    }
    f.context.checkpoint = async (current) => {
      if (current === "copying" && ++copies === 1) return;
      if (!reached && current === phase) {
        reached = true;
        await f.revoke();
      }
    };
    const result = await createMediaFileActivities(
      f.context,
    ).inspectAndStageMedia(f.acquired.input);
    expect(reached).toBe(true);
    expect(result).toEqual({
      status: "blocked",
      reason: "movie_edition_choice_changed",
    });
    const after = await cluster.database.acquisitionAttempt.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.movieEditionAuthority).toEqual(before.movieEditionAuthority);
    expect(after.movieEditionChoiceId).toBe(before.movieEditionChoiceId);
    expect(
      await cluster.database.libraryAsset.count({
        where: { coverage: { some: { mediaId: f.media.id } } },
      }),
    ).toBe(0);
    if (after.filePlan !== null) {
      for (const entry of FilePlanSchema.parse(after.filePlan)) {
        await expect(
          access(path.join(f.roots.control, `staging/${entry.operationId}`)),
        ).rejects.toMatchObject({ code: "ENOENT" });
        expect(
          JSON.parse(
            await readFile(
              path.join(f.roots.control, `journal/${entry.operationId}.json`),
              "utf8",
            ),
          ),
        ).toMatchObject({ phase: "prepared" });
        expect(
          await readFile(
            path.join(f.roots.control, `staging/${entry.operationId}.partial`),
            "utf8",
          ),
        ).toBe(f.acquired.content);
      }
    }
  },
);
