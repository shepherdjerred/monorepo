import { afterEach, beforeAll, expect, test } from "vitest";
import { z } from "zod";
import { createDatabase, type Database } from "#infrastructure/database.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { createPublicOwnerRestoreFixture } from "#testing/movie-workflow/public-owner-restore-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import {
  createOutboxActivities,
  type WorkflowStart,
} from "#automation/store.ts";
import { MovieLifecycleCommands } from "./commands.ts";

const closers: (() => Promise<void>)[] = [];
let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function tokyoDatabase(source: Database) {
  const address = z
    .array(
      z.strictObject({
        database: z.literal("postgres"),
        user: z.literal("media"),
        port: z.int().positive(),
      }),
    )
    .length(1)
    .parse(
      await source.$queryRaw`
      SELECT current_database() AS database,current_user AS "user",inet_server_port() AS port
    `,
    )[0];
  if (address === undefined)
    throw new Error("Actual disposable database endpoint missing");
  const url = new URL(
    `postgresql://media@127.0.0.1:${String(address.port)}/postgres`,
  );
  url.searchParams.set("options", "-c timezone=Asia/Tokyo");
  const db = createDatabase(url.toString());
  closers.push(() => db.$disconnect());
  expect(
    await db.$queryRaw`SELECT current_setting('TimeZone') AS timezone`,
  ).toEqual([{ timezone: "Asia/Tokyo" }]);
  return db;
}

test("public v4 request and explicit owner restore dispatch immediately in Tokyo sessions while retained files stay unchanged", async () => {
  const f = await createPublicOwnerRestoreFixture("directors_cut", bytes);
  closers.push(f.close);
  const db = await tokyoDatabase(f.db);
  const settings = {
    keepDays: 7,
    serverMachineId: "fixture-server",
    movieSectionId: "1",
  };
  const commands = new MovieLifecycleCommands(db, settings);
  const reads = new PrismaMediaApplication(db, settings);
  const before = {
    asset: await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.f.asset.id },
    }),
    quarantine: await db.operation.findUniqueOrThrow({
      where: { id: f.removeInput.operationId },
    }),
    attempts: await db.acquisitionAttempt.findMany({
      orderBy: { id: "asc" },
    }),
    torrents: await db.torrent.findMany({ orderBy: { id: "asc" } }),
  };
  const context = await reads.getMovieEditionContextV4(
    f.owner,
    f.f.scope.mediaId,
    f.owner.id,
  );
  const option = context.options.find(
    (value) => value.edition === "extended_cut",
  );
  if (option?.request !== null)
    throw new Error("Actual independent selected cut is unavailable");
  const requestInput = {
    schemaVersion: 4 as const,
    mediaId: f.f.scope.mediaId,
    subjectUserId: f.owner.id,
    expected: {
      mediaVersion: context.mediaVersion,
      targetVersion: option.targetVersion,
      definition: option.storedDefinition,
      request: null,
    },
    selection: {
      edition: option.edition,
      definitionVersion: option.definitionVersion,
      definitionDigest: option.definitionDigest,
      registryVersion: context.registryVersion,
    },
    options: { subtitleLanguages: ["en"] },
  };
  const requestKey = crypto.randomUUID();
  const requested = await commands.requestMovieEditionV4(
    f.owner,
    requestKey,
    requestInput,
  );
  expect(requested).toMatchObject({
    schemaVersion: 4,
    edition: "extended_cut",
    state: "queued",
  });
  expect(
    await commands.requestMovieEditionV4(f.owner, requestKey, requestInput),
  ).toEqual(requested);
  const reviewed = await reads.getMovieTargetContextV4(f.owner, f.f.scope);
  const restoreInput = {
    schemaVersion: 4 as const,
    scope: f.f.scope,
    expected: reviewed.expected,
    command: { action: "restore" as const },
  };
  const restoreKey = crypto.randomUUID();
  const restored = await commands.executeMovieLifecycleV4(
    f.owner,
    restoreKey,
    restoreInput,
  );
  expect(restored.result.status).toBe("queued");
  expect(
    await commands.executeMovieLifecycleV4(f.owner, restoreKey, restoreInput),
  ).toEqual(restored);
  const requestId = z.uuid().parse(requested.operationId);
  const restoreId = z.uuid().parse(restored.result.operationId);
  expect(
    await db.outboxCommand.count({
      where: { operationId: { in: [requestId, restoreId] } },
    }),
  ).toBe(2);
  const starts: WorkflowStart[] = [];
  await createOutboxActivities(db, (input) => {
    starts.push(input);
    return Promise.resolve();
  }).dispatchMediaOutbox();
  expect(starts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        workflowType: "reconcileMovieEditionV4Workflow",
        workflowId: `media-operation-${requestId}`,
        input: expect.objectContaining({
          schemaVersion: 4,
          scope: { ...f.f.scope, edition: "extended_cut" },
        }),
      }),
      expect.objectContaining({
        workflowType: "restoreMovieEditionV4Workflow",
        workflowId: `media-operation-${restoreId}`,
        input: expect.objectContaining({
          schemaVersion: 4,
          scope: f.f.scope,
        }),
      }),
    ]),
  );
  expect(
    await db.libraryAsset.findUniqueOrThrow({ where: { id: f.f.asset.id } }),
  ).toEqual(before.asset);
  expect(
    await db.operation.findUniqueOrThrow({
      where: { id: f.removeInput.operationId },
    }),
  ).toEqual(before.quarantine);
  expect(
    await db.acquisitionAttempt.findMany({ orderBy: { id: "asc" } }),
  ).toEqual(before.attempts);
  expect(await db.torrent.findMany({ orderBy: { id: "asc" } })).toEqual(
    before.torrents,
  );
  expect(f.f.source.wire.additions()).toBe(1);
}, 60_000);
