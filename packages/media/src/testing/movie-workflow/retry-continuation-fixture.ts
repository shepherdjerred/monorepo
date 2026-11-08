import { z } from "zod";
import { expect } from "vitest";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { FileContext } from "#automation/files/types.ts";
import type { Database } from "#infrastructure/database.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { MovieOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { MovieFilePlanSchema } from "#shared/movie-editions/management/contracts.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { createSweepActivities } from "#automation/sweeps.ts";
import { queryFixtureDatabase } from "#testing/query-client.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { createFixtureLifecycle } from "#testing/fixture-lifecycle.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { createMovieWorkflowFixture } from "./fixture.ts";
import { createAcquiredMovieUpgradeFixture } from "./upgrade-fixture.ts";
import { createManagedMovieFixture } from "./managed-fixture.ts";

export type MovieContinuationPhase =
  "prepared" | "intent" | "imported" | "plex";
type Options = {
  bytes?: Uint8Array;
  phase?: MovieContinuationPhase;
  upgrade?: { original: Uint8Array; next: Uint8Array; managed?: boolean };
};
type Base = {
  db: Database;
  actor: MediaActor;
  context: MediaAutomationContext;
  files: FileContext;
  input: z.infer<typeof MovieOperationV4Schema>;
  additions: () => number;
  forbidLiveTransfer: () => void;
  close: () => Promise<void>;
  predecessorAssetId: string | null;
  managementReceiptId: string | null;
};

async function createBase(
  edition: MovieEditionKey,
  options: Options,
): Promise<Base> {
  if (options.upgrade === undefined) {
    const f = await createMovieWorkflowFixture(
      edition,
      options.bytes === undefined ? {} : { bytes: options.bytes },
    );
    return {
      db: f.source.db,
      actor: f.source.user,
      context: f.source.context,
      files: f.source.files.context,
      input: f.input,
      additions: f.source.wire.additions,
      forbidLiveTransfer: () => {
        f.source.wire.control.beforeInfo = () =>
          Promise.reject(
            new Error("Imported continuation must not inspect a live transfer"),
          );
      },
      close: f.close,
      predecessorAssetId: null,
      managementReceiptId: null,
    };
  }
  const bytes = {
    original: options.upgrade.original,
    upgrade: options.upgrade.next,
  };
  if (options.upgrade.managed !== true) {
    const f = await createAcquiredMovieUpgradeFixture(edition, bytes);
    return {
      db: f.context.db,
      actor: f.network.actor,
      context: f.context,
      files: f.files,
      input: f.input,
      additions: f.wire.additions,
      forbidLiveTransfer: () => {
        f.wire.control.beforeInfo = () =>
          Promise.reject(
            new Error("Imported continuation must not inspect a live transfer"),
          );
      },
      close: f.close,
      predecessorAssetId: f.asset.id,
      managementReceiptId: null,
    };
  }
  const { db, directories, close } = await createFixtureLifecycle();
  try {
    const f = await createManagedMovieFixture(
      { database: () => db },
      edition,
      (directory) => directories.push(directory),
      bytes,
    );
    return {
      db,
      actor: f.network.actor,
      context: f.context,
      files: f.files,
      input: f.input,
      additions: f.wire.additions,
      forbidLiveTransfer: () => {
        f.wire.control.beforeInfo = () =>
          Promise.reject(
            new Error("Imported continuation must not inspect a live transfer"),
          );
      },
      close,
      predecessorAssetId: f.asset.id,
      managementReceiptId: f.receiptId,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** Real acquisition/publication phases and honest dependency faults; no authority or terminal history is fabricated. */
export async function createMovieContinuationFixture(
  edition: MovieEditionKey,
  options: Options = {},
) {
  const base = await createBase(edition, options);
  const control: {
    fault: MovieContinuationPhase | null;
    describe: MediaAutomationContext["describeWorkflow"];
    physicalCheckpoints: string[];
  } = {
    fault: null,
    describe: base.context.describeWorkflow,
    physicalCheckpoints: [],
  };
  const db = queryFixtureDatabase(base.db, {
    query: {
      operation: {
        async findUniqueOrThrow({ args, query }) {
          if (
            control.fault === "imported" &&
            args.where.id === base.input.operationId
          ) {
            const attempt = await base.db.acquisitionAttempt.findUnique({
              where: { operationId: base.input.operationId },
            });
            if (attempt?.state === "imported")
              throw new Error(
                "Synthetic imported movie publication dependency unavailable",
              );
          }
          return query(args);
        },
      },
      acquisitionAttempt: {
        async update({ args, query }) {
          if (control.fault === "plex" && args.data.state === "completed")
            throw new Error(
              "Synthetic committed movie finalization dependency unavailable",
            );
          return query(args);
        },
      },
    },
  });
  const context: MediaAutomationContext = {
    ...base.context,
    db,
    describeWorkflow: (id) => control.describe(id),
  };
  const files: FileContext = {
    ...base.files,
    checkpoint: async (phase) => {
      await base.files.checkpoint(phase);
      control.physicalCheckpoints.push(phase);
      if (
        phase === "publication-intent-committed" &&
        control.fault === "intent"
      )
        throw new Error(
          "Synthetic committed movie intent dependency unavailable",
        );
    },
  };
  const movie = createMovieNetworkFacetV4(context);
  const fileMovie = createMovieFileFacetV4(files);
  const outbox = createOutboxActivities(base.db, () =>
    Promise.reject(new Error("Completion cannot dispatch")),
  );
  const attempt = () =>
    base.db.acquisitionAttempt.findUnique({
      where: { operationId: base.input.operationId },
    });
  const fixture = {
    ...base,
    context,
    files,
    movie,
    fileMovie,
    control,
    useDescriptions: (read: MediaAutomationContext["describeWorkflow"]) => {
      control.describe = read;
    },
    enableFailure: (phase: MovieContinuationPhase) => {
      control.fault = phase;
    },
    allowRecovery: () => {
      control.fault = null;
    },
    finishMediaOperation: outbox.finishMediaOperation,
    dispatch: (start: WorkflowStarter) =>
      createOutboxActivities(base.db, start).dispatchMediaOutbox(),
    async settleOriginalFailure() {
      await outbox.finishMediaOperation({
        operationId: base.input.operationId,
        status: "reconciling",
        reason: "movie_operation_failed",
      });
    },
    async retry(automatic = false) {
      const original = await attempt();
      if (original === null)
        throw new Error("Actual continuation has no acquisition to retry");
      if (automatic) {
        await createSweepActivities(context).sweepMediaWork({
          kind: "downloads",
          cursor: null,
          sweepId: crypto.randomUUID(),
        });
      } else {
        const media = await base.db.mediaItem.findUniqueOrThrow({
          where: { id: base.input.mediaId },
        });
        const target = await base.db.mediaIntent.findUniqueOrThrow({
          where: { mediaId_edition: { mediaId: base.input.mediaId, edition } },
        });
        const sections = await context.permittedSections();
        await new MovieLifecycleCommands(base.db, {
          keepDays: 30,
          serverMachineId: z.string().min(1).parse(context.serverMachineId),
          movieSectionId: sections.movie,
        }).retryMovieEditionV4(base.actor, crypto.randomUUID(), {
          schemaVersion: 4,
          scope: base.input.scope,
          expected: {
            mediaVersion: media.version,
            targetVersion: target.version,
          },
          command: { action: "retry" },
        });
      }
      const commands = await base.db.operation.findMany({
        where: {
          kind: "reconcile_movie_edition_v4",
          status: "queued",
          OR: [
            {
              payload: {
                path: ["movieRetryV2", "attemptId"],
                equals: original.id,
              },
            },
            {
              payload: {
                path: ["movieRetryPlexAckV1", "originalInput", "attemptId"],
                equals: original.id,
              },
            },
          ],
        },
        take: 2,
      });
      expect(commands).toHaveLength(1);
      const operation = commands[0];
      if (operation === undefined)
        throw new Error("Actual continuation command missing");
      return {
        operation,
        input: MovieOperationV4Schema.parse(
          z.object(MovieOperationV4Schema.shape).parse(operation.payload),
        ),
      };
    },
    async evidence() {
      const current = await attempt();
      const plan =
        current?.filePlan == null
          ? null
          : MovieFilePlanSchema.parse(current.filePlan);
      return {
        attempt: current,
        plan,
        operation: await base.db.operation.findUniqueOrThrow({
          where: { id: base.input.operationId },
        }),
        publication:
          current === null
            ? null
            : await base.db.mediaPublicationTransition.findUnique({
                where: { attemptId: current.id },
              }),
        assets: await base.db.libraryAsset.findMany({
          where: { editionRootId: base.input.mediaId, edition },
          include: { coverage: true, subtitles: { orderBy: { id: "asc" } } },
          orderBy: { id: "asc" },
        }),
        target: await base.db.mediaIntent.findUniqueOrThrow({
          where: { mediaId_edition: { mediaId: base.input.mediaId, edition } },
        }),
        choices: await base.db.movieEditionChoice.findMany({
          where: { rootMediaId: base.input.mediaId },
          orderBy: { id: "asc" },
        }),
        requests: await base.db.mediaRequest.findMany({
          where: { mediaId: base.input.mediaId },
          orderBy: { id: "asc" },
        }),
        torrentCount: await base.db.torrent.count(),
        adds: base.additions(),
      };
    },
    async journalEvidence() {
      const current = await attempt();
      if (current?.filePlan == null) return [];
      const plan = MovieFilePlanSchema.parse(current.filePlan);
      const entry = plan.entries[0];
      const ids = [
        entry.operationId,
        ...entry.previousSidecars.map((row) => row.operationId),
      ];
      return Promise.all(
        ids.map(async (id) => {
          const file = Bun.file(
            path.join(files.roots.movies.control, "journal", `${id}.json`),
          );
          return {
            id,
            literal: (await file.exists()) ? await file.text() : null,
          };
        }),
      );
    },
    async fileEvidence() {
      const rows = await base.db.libraryAsset.findMany({
        where: {
          editionRootId: base.input.mediaId,
          edition,
          state: { in: ["published", "superseded"] },
        },
        include: {
          subtitles: {
            where: {
              state: { in: ["installed", "superseded"] },
              storageKind: "sidecar",
            },
            orderBy: { id: "asc" },
          },
        },
        orderBy: { id: "asc" },
      });
      return Promise.all(
        rows
          .flatMap((row) => [
            row.path,
            ...row.subtitles.map((subtitle) => z.string().parse(subtitle.path)),
          ])
          .map(async (stored) => {
            const bytes = await readFile(workerFilePath(files, stored));
            return {
              path: stored,
              size: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            };
          }),
      );
    },
  };
  try {
    if (options.phase !== undefined) await preparePhase(fixture, options.phase);
    return fixture;
  } catch (error) {
    await base.close();
    throw error;
  }
}

async function preparePhase(
  f: Awaited<ReturnType<typeof createMovieContinuationFixture>>,
  phase: MovieContinuationPhase,
) {
  const reserved = await f.movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  expect(reserved, JSON.stringify(reserved)).toMatchObject({
    status: "acquire",
  });
  const input = {
    schemaVersion: 4 as const,
    operationId: f.input.operationId,
    attemptId: z.uuid().parse(reserved.attemptId),
    scope: f.input.scope,
  };
  expect(
    await f.movie.submitMovieTorrentV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "submitted", reason: null });
  expect(
    await f.movie.observeMovieAcquisitionV4(input, testPlexBindingExecution()),
  ).toEqual({ status: "ready", reason: null });
  expect(
    await f.fileMovie.inspectAndStageMovieV4(input, testPublicationExecution()),
  ).toEqual({ status: "staged" });
  if (phase === "prepared") return;
  if (phase === "intent") {
    f.enableFailure("intent");
    await expect(
      f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
    ).rejects.toThrow(
      "Synthetic committed movie intent dependency unavailable",
    );
    f.allowRecovery();
    return;
  }
  expect(
    await f.fileMovie.promoteMovieFilesV4(input, testPublicationExecution()),
  ).toEqual({ status: "published" });
  if (phase === "plex")
    expect(
      await f.movie.publishMovieToPlexV4(input, testPlexBindingExecution()),
    ).toEqual({ status: "available", reason: null });
}
