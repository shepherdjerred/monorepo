import { afterEach, beforeAll, expect, test } from "vitest";
import { readFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { createPublicOwnerRestoreFixture } from "#testing/movie-workflow/public-owner-restore-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { MovieEditionKeySchema } from "#shared/movie-editions/registry.ts";
import { MovieLifecycleCommandV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/lifecycle/automation-v4.ts";
import {
  MovieRestoreReceiptEnvelopeV1Schema,
  type MovieRestoreReceiptV1,
} from "#shared/movie-editions/restore-v1.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { restoreMovieFilesV4 } from "#automation/movie-editions/retention/restore.ts";
import { publishRestoredMovieToPlexV4 } from "#automation/movie-editions/retention/restore-plex.ts";
import { finalizeMovieRestorationV4 } from "#automation/movie-editions/retention/restore-finalization.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";

let bytes: Uint8Array;
const closers: (() => Promise<void>)[] = [];
beforeAll(async () => {
  bytes = await movieVideoFixture();
});
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
});
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

for (const edition of MovieEditionKeySchema.options) {
  test(`actual owner restores ${edition} after genuine personal cancellation without manufacturing demand`, async () => {
    const f = await createPublicOwnerRestoreFixture(edition, bytes);
    closers.push(f.close);
    const before = {
      quarantine: await f.db.operation.findUniqueOrThrow({
        where: { id: f.removeInput.operationId },
      }),
      publication: await f.db.operation.findUniqueOrThrow({
        where: { id: f.f.input.operationId },
      }),
      request: await f.db.mediaRequest.findFirstOrThrow({
        where: { mediaId: f.f.scope.mediaId, edition },
      }),
      choices: await f.db.movieEditionChoice.findMany({
        where: { rootMediaId: f.f.scope.mediaId },
        orderBy: { id: "asc" },
      }),
      attempts: await f.db.acquisitionAttempt.findMany({
        where: { mediaIds: { has: f.f.scope.mediaId } },
      }),
      torrents: await f.db.torrent.findMany(),
      pointer: await f.db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.f.scope.mediaId, edition } },
      }),
    };
    const held = await f.view();
    const keep = await f.commands.executeMovieLifecycleV4(
      f.owner,
      crypto.randomUUID(),
      MovieLifecycleCommandV4Schema.parse({
        schemaVersion: 4,
        scope: f.f.scope,
        expected: held.expected,
        command: { action: "keep" },
      }),
    );
    expect(keep.result).toMatchObject({ status: "completed" });
    expect(keep.result.operationId).toBeUndefined();
    const stillQuarantined = await f.view();
    expect(stillQuarantined).toMatchObject({
      access: "detail",
      target: {
        availability: "quarantined",
        desiredPresence: false,
        monitoring: false,
        libraryMonitoring: false,
      },
    });
    const key = crypto.randomUUID();
    const command = MovieLifecycleCommandV4Schema.parse({
      schemaVersion: 4,
      scope: f.f.scope,
      expected: stillQuarantined.expected,
      command: { action: "restore" },
    });
    const result = await f.commands.executeMovieLifecycleV4(
      f.owner,
      key,
      command,
    );
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { id: z.uuid().parse(result.result.operationId) },
    });
    expect(operation.payload).toMatchObject({
      ownerRestoreV1: { actorId: f.owner.id, request: command },
    });
    const input = MovieOperationV4Schema.parse(
      z.object(MovieOperationV4Schema.shape).parse(operation.payload),
    );
    const execution = testPublicationExecution();
    await restoreMovieFilesV4(
      {
        ...f.f.source.files.context,
        publicationExecution: () => execution,
        movieManagement: {
          execution,
          budget: new PublicationAuthorityReadBudget(),
        },
      },
      input,
    );
    const committed = await f.db.operation.findUniqueOrThrow({
      where: { id: input.operationId },
    });
    const receipt = MovieRestoreReceiptEnvelopeV1Schema.parse(
      z.object({ movieRestoreReceiptV1: z.json() }).parse(committed.result)
        .movieRestoreReceiptV1,
    ).receipt;
    expect(receipt).toMatchObject({
      scope: f.f.scope,
      input,
      quarantine: {
        operationId: f.removeInput.operationId,
        decisionId: f.decisionId,
      },
      before: { id: f.f.asset.id, state: "quarantined" },
      after: {
        id: f.f.asset.id,
        state: "published",
        plexPublishedAt: f.f.asset.plexPublishedAt?.toISOString(),
      },
    });
    await assertRestoredOwnerBytes(f, input, receipt);
    expect(
      await publishRestoredMovieToPlexV4(
        f.f.source.context,
        input,
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "available", reason: null });
    await finalizeMovieRestorationV4(
      f.f.source.context,
      input,
      testPlexBindingExecution(),
    );
    expect(await f.view()).toMatchObject({
      access: "detail",
      target: {
        availability: "available",
        desiredPresence: true,
        monitoring: true,
        libraryMonitoring: false,
      },
      currentAsset: {
        id: f.f.asset.id,
        state: "published",
        version: f.f.asset.version + 2,
        captionsTruncated: false,
      },
    });
    expect(
      await f.db.plexBindingCurrent.findUniqueOrThrow({
        where: { mediaId_edition: { mediaId: f.f.scope.mediaId, edition } },
      }),
    ).toMatchObject({ revision: before.pointer.revision + 1 });
    expect(
      await f.db.mediaRequest.findUniqueOrThrow({
        where: { id: before.request.id },
      }),
    ).toEqual(before.request);
    expect(
      await f.db.movieEditionChoice.findMany({
        where: { rootMediaId: f.f.scope.mediaId },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before.choices);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.removeInput.operationId },
      }),
    ).toEqual(before.quarantine);
    expect(
      await f.db.operation.findUniqueOrThrow({
        where: { id: f.f.input.operationId },
      }),
    ).toEqual(before.publication);
    expect(
      await f.db.acquisitionAttempt.findMany({
        where: { mediaIds: { has: f.f.scope.mediaId } },
      }),
    ).toEqual(before.attempts);
    expect(await f.db.torrent.findMany()).toEqual(before.torrents);
    expect(f.f.source.wire.additions()).toBe(1);
    expect(
      await f.commands.executeMovieLifecycleV4(f.owner, key, command, () =>
        Promise.reject(
          new Error("Historical explicit restore ACK must precede gates"),
        ),
      ),
    ).toEqual(result);
  }, 60_000);
}

test("owner self holds remain protective with an actually unconfigured movie section and never imply restoration", async () => {
  const f = await createPublicOwnerRestoreFixture("directors_cut", bytes);
  closers.push(f.close);
  const commands = new PrismaMediaApplication(f.db, {
    keepDays: 7,
    serverMachineId: "fixture-server",
  });
  const original = await f.view();
  const operations = await f.db.operation.count();
  const quarantine = await f.db.operation.findUniqueOrThrow({
    where: { id: f.removeInput.operationId },
  });
  const checksums = await quarantinedOwnerChecksums(f);
  for (const action of ["keep", "pin", "unpin"] as const) {
    const current = await commands.getMovieTargetContextV4(f.owner, f.f.scope);
    expect(current.access).toBe("protection_only");
    expect(current).not.toHaveProperty("title");
    expect(current).not.toHaveProperty("target");
    expect(current).not.toHaveProperty("removalConfirmation");
    expect(current).not.toHaveProperty("currentAsset");
    const result = await commands.executeMovieLifecycleV4(
      f.owner,
      crypto.randomUUID(),
      MovieLifecycleCommandV4Schema.parse({
        schemaVersion: 4,
        scope: f.f.scope,
        expected: current.expected,
        command: { action },
      }),
    );
    expect(result.result).toMatchObject({ status: "completed" });
    expect(result.result.operationId).toBeUndefined();
    expect(await f.view()).toMatchObject({
      access: "detail",
      target: {
        availability: "quarantined",
        desiredPresence: false,
        monitoring: false,
        libraryMonitoring: false,
      },
    });
  }
  const current = await f.view();
  if (original.access !== "detail" || current.access !== "detail")
    throw new Error(
      "Actual configured owner review unexpectedly lost its detail scope",
    );
  expect(current.target.generation).toBe(original.target.generation);
  expect(current.ownHold).toBeNull();
  await expect(
    commands.executeMovieLifecycleV4(
      f.owner,
      crypto.randomUUID(),
      MovieLifecycleCommandV4Schema.parse({
        schemaVersion: 4,
        scope: f.f.scope,
        expected: current.expected,
        command: { action: "restore" },
      }),
    ),
  ).rejects.toMatchObject({ code: "plex_scope_unconfigured" });
  expect(await f.db.operation.count()).toBe(operations);
  expect(
    await f.db.operation.findUniqueOrThrow({
      where: { id: f.removeInput.operationId },
    }),
  ).toEqual(quarantine);
  expect(await quarantinedOwnerChecksums(f)).toEqual(checksums);
  expect(
    await f.db.mediaRequest.count({
      where: {
        mediaId: f.f.scope.mediaId,
        edition: f.f.scope.edition,
        active: true,
        excluded: false,
      },
    }),
  ).toBe(0);
}, 60_000);

async function quarantinedOwnerChecksums(
  f: Awaited<ReturnType<typeof createPublicOwnerRestoreFixture>>,
) {
  const decision = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: f.decisionId },
  });
  const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
  if (entry === undefined)
    throw new Error("Actual owner quarantine omitted its native manifest");
  const checksums = [];
  for (const file of [entry, ...entry.sidecars]) {
    const content = await readFile(
      path.join(
        f.f.source.files.roots.movies.control,
        "quarantine",
        file.quarantineId,
      ),
    );
    const actual = digest(content);
    expect(actual).toBe(file.checksum);
    checksums.push({ id: file.quarantineId, sha256: actual });
  }
  expect(checksums).toHaveLength(3);
  return checksums;
}

async function assertRestoredOwnerBytes(
  f: Awaited<ReturnType<typeof createPublicOwnerRestoreFixture>>,
  input: MovieOperationV4,
  receipt: MovieRestoreReceiptV1,
) {
  expect(receipt.journals).toHaveLength(3);
  expect(receipt.participants).toHaveLength(6);
  const decision = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: f.decisionId },
  });
  const entry = RemovalPlanSchema.parse(decision.manifest).assets[0];
  if (entry === undefined)
    throw new Error("Actual restore lost its quarantine manifest");
  expect(entry.sidecars).toHaveLength(2);
  for (const file of [
    { id: entry.assetId, ...entry },
    ...entry.sidecars.map((row) => ({ id: row.subtitleId, ...row })),
  ]) {
    const original =
      file.id === f.f.asset.id
        ? receipt.after
        : receipt.after.subtitles.find((row) => row.id === file.id);
    if (original?.path == null)
      throw new Error("Actual restored participant omitted its library path");
    const restoredPath = workerFilePath(
      f.f.source.files.context,
      original.path,
    );
    expect(digest(await readFile(restoredPath))).toBe(file.checksum);
    const source = path.join(
      f.f.source.files.roots.movies.control,
      "quarantine",
      file.quarantineId,
    );
    await expect(access(source)).rejects.toMatchObject({ code: "ENOENT" });
    const operationId = `${input.operationId}-restore-${file.quarantineId}`;
    expect(
      ManifestSchema.parse(
        JSON.parse(
          await readFile(
            path.join(
              f.f.source.files.roots.movies.control,
              "journal",
              `${operationId}.json`,
            ),
            "utf8",
          ),
        ),
      ),
    ).toMatchObject({
      operationId,
      kind: "restore",
      phase: "complete",
      source,
      target: restoredPath,
      sha256: file.checksum,
    });
  }
}
