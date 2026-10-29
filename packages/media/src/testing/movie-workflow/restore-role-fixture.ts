import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { createMovieRetentionFixture } from "./retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { requestTestMovieV4 } from "#testing/movie-v4.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import { quarantineMovieFilesV4 } from "#automation/movie-editions/retention/quarantine.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { exists } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { warningHistory } from "#automation/retention/fixtures/elapsed.ts";
import { PrismaPlexEventIngress } from "#infrastructure/plex-events/ingress.ts";
import { ObserveMoviePlexHintV4Schema } from "#shared/plex-events/contract.ts";
import { readCurrentPlexBinding } from "#infrastructure/plex-binding/read.ts";
import { readCurrentBoundWatch } from "#infrastructure/plex-binding/watch.ts";
import { readMovieRequestFulfillment } from "#infrastructure/movie-editions/fulfillment.ts";
import { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";

type Baseline = Awaited<ReturnType<typeof createMovieRetentionFixture>>;
type Request = Awaited<ReturnType<typeof requestTestMovieV4>>;

/** Stops before restore: a genuine requester command must cross the real Files/Plex workers. */
export async function createMovieRestoreWorkflowFixture(
  edition: MovieEditionKey,
) {
  const f = await createMovieRetentionFixture(
    edition,
    await movieVideoFixture(),
  );
  try {
    const originalBinding = await f.db.plexBindingCurrent.findUniqueOrThrow({
      where: { mediaId_edition: { mediaId: f.scope.mediaId, edition } },
    });
    const originalAssociation =
      await f.db.plexAssociationEvidence.findUniqueOrThrow({
        where: { id: z.uuid().parse(originalBinding.evidenceId) },
      });
    const warning = await f.warning();
    if (warning.status !== "warning")
      throw new Error("Real restore prerequisite warning was not created");
    await f.deliverWarning();
    const eligible = await f.evaluate();
    const decisionId = eligible.decisionId;
    if (
      decisionId === null ||
      f.context.now === undefined ||
      eligible.status !== "quarantine"
    )
      throw new Error("Real restore prerequisite never authorized quarantine");
    const execution = testPublicationExecution();
    await quarantineMovieFilesV4(
      {
        ...f.source.files.context,
        now: f.context.now,
        publicationExecution: () => execution,
        movieManagement: {
          execution,
          budget: new PublicationAuthorityReadBudget(),
        },
      },
      {
        schemaVersion: 4,
        operationId: f.input.operationId,
        decisionId,
        scope: f.scope,
      },
    );
    const request = await requestTestMovieV4(
      f.db,
      f.source.user,
      f.scope.mediaId,
      edition,
    );
    const command = await f.db.operation.findUniqueOrThrow({
      where: { id: request.input.operationId },
    });
    if (command.kind !== "restore_movie_edition_v4")
      throw new Error("Genuine post-quarantine request did not queue restore");
    const context = { ...f.context, now: () => new Date() };
    const completion = createOutboxActivities(f.db, () =>
      Promise.reject(new Error("Completion cannot dispatch")),
    );
    const events = () =>
      f.db.notificationDelivery.findMany({
        where: {
          event: {
            mediaId: f.scope.mediaId,
            payload: { path: ["kind"], equals: "movie_restoration" },
            AND: [
              {
                payload: {
                  path: ["source", "operationId"],
                  equals: request.input.operationId,
                },
              },
            ],
          },
        },
        include: { event: true },
        orderBy: { id: "asc" },
      });
    return {
      input: request.input,
      scope: f.scope,
      originalBinding,
      originalAssociation,
      movie: createMovieNetworkFacetV4(context),
      fileMovie: createMovieFileFacetV4(f.source.files.context),
      ...createPlexRuntimeFacets(context, () => Promise.resolve(true)),
      finishMediaOperation: completion.finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(f.db, start).dispatchMediaOutbox(),
      async restorationNoticeOperationIds() {
        const deliveries = await events();
        const operations = await f.db.operation.findMany({
          where: {
            kind: "deliver_notification",
            targetId: { in: deliveries.map((row) => row.id) },
          },
          select: { id: true },
        });
        return operations.map((row) => row.id);
      },
      async watchOperation() {
        f.source.wire.setWatched(true);
        await new PrismaPlexEventIngress(f.db, {
          serverMachineId: "fixture-server",
          permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
        }).accept({
          schemaVersion: 1,
          event: "media.scrobble",
          serverMachineId: "fixture-server",
          sectionId: "1",
          ratingKey: f.source.wire.ratingKey,
          mediaKind: "movie",
        });
        const operation = await f.db.operation.findFirstOrThrow({
          where: {
            targetId: f.scope.mediaId,
            kind: "observe_movie_plex_hint_v4",
          },
          orderBy: { createdAt: "desc" },
        });
        return ObserveMoviePlexHintV4Schema.parse(operation.payload);
      },
      readiness: () => restoreReadiness(f, request),
      evidence: async () => ({
        ...(await restoreRoleEvidence(f, request, decisionId)),
        notices: await events(),
      }),
      close: f.close,
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}

async function restoreRoleEvidence(
  f: Baseline,
  request: Request,
  decisionId: string,
) {
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
    include: { subtitles: { orderBy: { id: "asc" } }, coverage: true },
  });
  const decision = await f.db.retentionDecision.findUniqueOrThrow({
    where: { id: decisionId },
  });
  const manifest = RemovalPlanSchema.parse(decision.manifest);
  const paths = [
    asset.path,
    ...asset.subtitles
      .filter(
        (subtitle) =>
          subtitle.storageKind === "sidecar" &&
          ["installed", "quarantined"].includes(subtitle.state),
      )
      .map((subtitle) => z.string().parse(subtitle.path)),
  ];
  const library = await Promise.all(
    paths.map((filename) =>
      physicalFile(workerFilePath(f.source.files.context, filename)),
    ),
  );
  const quarantined = await Promise.all(
    manifest.assets.flatMap((entry) =>
      [entry, ...entry.sidecars].map((file) =>
        physicalFile(
          path.join(
            f.source.files.roots.movies.control,
            "quarantine",
            file.quarantineId,
          ),
        ),
      ),
    ),
  );
  const journalDirectory = path.join(
    f.source.files.roots.movies.control,
    "journal",
  );
  const journalNames = await readdir(journalDirectory);
  const names = journalNames
    .filter((name) => name.startsWith(`${request.input.operationId}-`))
    .sort();
  const journals = await Promise.all(
    names.map(async (name) =>
      ManifestSchema.parse(
        JSON.parse(await readFile(path.join(journalDirectory, name), "utf8")),
      ),
    ),
  );
  const selected = { mediaId: f.scope.mediaId, edition: f.scope.edition };
  const binding = await f.db.plexBindingCurrent.findUniqueOrThrow({
    where: { mediaId_edition: selected },
  });
  return {
    operation: await f.db.operation.findUniqueOrThrow({
      where: { id: request.input.operationId },
      include: { outbox: true },
    }),
    quarantine: await f.db.operation.findUniqueOrThrow({
      where: { id: f.input.operationId },
    }),
    publication: await f.db.operation.findUniqueOrThrow({
      where: { id: f.publicationOperationId },
    }),
    originalAssociation: await f.db.plexAssociationEvidence.findFirstOrThrow({
      where: { mediaId: selected.mediaId, edition: selected.edition },
      orderBy: { createdAt: "asc" },
    }),
    association:
      binding.evidenceId === null
        ? null
        : await f.db.plexAssociationEvidence.findUniqueOrThrow({
            where: { id: binding.evidenceId },
          }),
    binding,
    asset,
    decision,
    library,
    quarantined,
    journals,
    target: await f.db.mediaIntent.findUniqueOrThrow({
      where: { mediaId_edition: selected },
    }),
    history: await warningHistory(f.db, decisionId),
    attempts: await f.db.acquisitionAttempt.findMany({
      where: { mediaIds: { has: f.scope.mediaId } },
      orderBy: { id: "asc" },
    }),
    torrents: await f.db.torrent.findMany({ orderBy: { id: "asc" } }),
    seeding: await f.db.operation.findMany({
      where: { kind: "maintain_torrent" },
      orderBy: { id: "asc" },
    }),
    transitions: await f.db.mediaPublicationTransition.findMany({
      where: { intent: { path: ["scope"], equals: f.scope } },
      orderBy: { id: "asc" },
    }),
    subtitleCommands: await f.db.operation.findMany({
      where: {
        kind: "acquire_movie_subtitles_v4",
        payload: { path: ["scope", "mediaId"], equals: f.scope.mediaId },
      },
      orderBy: { id: "asc" },
    }),
    sends: structuredClone(f.sent),
  };
}

async function restoreReadiness(f: Baseline, request: Request) {
  const budget = new PublicationAuthorityReadBudget();
  const access = { serverMachineId: "fixture-server", movieSectionId: "1" };
  const asset = await f.db.libraryAsset.findUniqueOrThrow({
    where: { id: f.asset.id },
  });
  const fulfillment = await readMovieRequestFulfillment(f.db, {
    requestId: request.result.requestId,
    currentAsset: { assetId: asset.id, assetVersion: asset.version },
    access,
    expectedScope: f.scope,
    budget,
  });
  const captions = await currentMovieSubtitleWorkV4(
    f.db,
    { scope: f.scope, assetId: asset.id, epoch: asset.ownershipEpoch, access },
    budget,
  );
  const binding = await readCurrentPlexBinding(
    f.db,
    {
      scope: { mediaId: f.scope.mediaId, edition: f.scope.edition },
      assetId: asset.id,
      access: {
        serverMachineId: "fixture-server",
        sectionId: "1",
        sectionType: "movie",
      },
    },
    budget,
  );
  if (binding.status !== "current")
    throw new Error("Actual restored readiness has no current serving binding");
  const watch = await readCurrentBoundWatch(
    f.db,
    {
      userId: f.source.user.id,
      authority: { purpose: "current_serving", binding: binding.snapshot },
    },
    budget,
  );
  return {
    fulfillment,
    watch,
    protectedReasons: captions.protectedReasons,
    targets: captions.targets.map((target) => ({
      language: target.language,
      complete: captions.asset.subtitles.some((subtitle) =>
        subtitleAccepted({
          subtitle,
          asset: captions.asset,
          epoch: asset.ownershipEpoch,
          target,
        }),
      ),
    })),
  };
}

async function physicalFile(filename: string) {
  if (!(await exists(filename))) return { filename, checksum: null };
  return {
    filename,
    checksum: createHash("sha256")
      .update(await readFile(filename))
      .digest("hex"),
  };
}
