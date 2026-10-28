import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { createMovieRetentionFixture } from "./retention-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { createMovieNetworkFacetV4 } from "#automation/movie-editions/activities.ts";
import { createMovieFileFacetV4 } from "#automation/files/movie-editions/activities.ts";
import { createPlexRuntimeFacets } from "#automation/network/plex-facets.ts";
import {
  createOutboxActivities,
  type WorkflowStarter,
} from "#automation/store.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import { exists } from "#filesystem/operations-io.ts";
import { workerFilePath } from "#automation/files/paths/locations.ts";
import { warningHistory } from "#automation/retention/fixtures/elapsed.ts";

/** Real published/captioned bytes precede retention; only policy time advances from actual DB milestones. */
export async function createMovieRetentionWorkflowFixture(
  edition: MovieEditionKey,
) {
  const f = await createMovieRetentionFixture(
    edition,
    await movieVideoFixture(),
    false,
  );
  const selected = { mediaId: f.scope.mediaId, edition };
  let policyAt: number | null = null;
  const policyNow = () => new Date(Math.max(Date.now(), policyAt ?? 0));
  const context = { ...f.context, now: policyNow };
  const completion = createOutboxActivities(f.db, () =>
    Promise.reject(new Error("Completion cannot dispatch")),
  );
  const decision = () =>
    f.db.retentionDecision.findFirst({
      where: { ...selected, generation: f.input.generation },
      orderBy: { createdAt: "desc" },
    });
  const deliveries = () =>
    f.db.notificationDelivery.findMany({
      where: {
        event: {
          mediaId: selected.mediaId,
          kind: "retention_warning",
          payload: { path: ["scope", "edition"], equals: edition },
        },
      },
      include: { event: true },
      orderBy: { id: "asc" },
    });
  const movie = createMovieNetworkFacetV4(context);
  const fileMovie = createMovieFileFacetV4({
    ...f.source.files.context,
    now: policyNow,
  });
  return {
    input: f.input,
    scope: f.scope,
    movie,
    fileMovie,
    ...createPlexRuntimeFacets(context, () => Promise.resolve(false)),
    finishMediaOperation: completion.finishMediaOperation,
    dispatch: (start: WorkflowStarter) =>
      createOutboxActivities(f.db, start).dispatchMediaOutbox(),
    async warningOperationIds() {
      const rows = await deliveries();
      const operations = await f.db.operation.findMany({
        where: {
          kind: "deliver_notification",
          targetId: { in: rows.map((row) => row.id) },
        },
        select: { id: true },
      });
      return operations.map((row) => row.id);
    },
    /** Test policy clock only: source/SDK/SQL timestamps and literal producer outputs stay untouched. */
    async advancePolicyFromActualState() {
      const current = await decision();
      if (current?.state === "quarantined") {
        if (
          current.quarantinedAt === null ||
          current.quarantinedAt.getTime() > Date.now()
        )
          throw new Error("Role quarantine has no actual wall-clock commit");
        policyAt = current.quarantinedAt.getTime() + 7 * 86_400_000 + 1;
        return;
      }
      const currentDeliveries = await deliveries();
      const accepted = currentDeliveries.filter(
        (row) => row.state === "accepted" && row.acceptedAt !== null,
      );
      if (accepted.length === 0) return;
      const timestamps = accepted.map((row) =>
        z.date().parse(row.acceptedAt).getTime(),
      );
      if (timestamps.some((value) => value > Date.now()))
        throw new Error("Role warning acceptance moved outside the real clock");
      policyAt = Math.max(...timestamps) + 7 * 86_400_000 + 1;
    },
    async evidence() {
      const current = await decision();
      const warnings = await deliveries();
      const asset = await f.db.libraryAsset.findUniqueOrThrow({
        where: { id: f.asset.id },
        include: { subtitles: { orderBy: { id: "asc" } }, coverage: true },
      });
      const paths = [
        asset.path,
        ...asset.subtitles
          .filter(
            (row) =>
              row.storageKind === "sidecar" &&
              ["installed", "quarantined", "purged"].includes(row.state),
          )
          .map((row) => z.string().parse(row.path)),
      ];
      const library = await Promise.all(
        paths.map((filename) =>
          physicalFile(workerFilePath(f.source.files.context, filename)),
        ),
      );
      const manifest =
        current?.manifest == null
          ? null
          : RemovalPlanSchema.parse(current.manifest);
      const quarantined = await Promise.all(
        (manifest?.assets ?? []).flatMap((entry) =>
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
      const names = await readdir(
        path.join(f.source.files.roots.movies.control, "journal"),
      );
      const journals = await Promise.all(
        names
          .filter((name) => name.startsWith(`${f.input.operationId}-`))
          .sort()
          .map(async (name) =>
            ManifestSchema.parse(
              JSON.parse(
                await readFile(
                  path.join(
                    f.source.files.roots.movies.control,
                    "journal",
                    name,
                  ),
                  "utf8",
                ),
              ),
            ),
          ),
      );
      return {
        operation: await f.db.operation.findUniqueOrThrow({
          where: { id: f.input.operationId },
          include: { outbox: true },
        }),
        publication: await f.db.operation.findUniqueOrThrow({
          where: { id: f.publicationOperationId },
        }),
        transitions: await f.db.mediaPublicationTransition.findMany({
          where: { intent: { path: ["scope"], equals: f.scope } },
          orderBy: { id: "asc" },
        }),
        binding: await f.db.plexBindingCurrent.findUniqueOrThrow({
          where: { mediaId_edition: selected },
        }),
        target: await f.db.mediaIntent.findUniqueOrThrow({
          where: { mediaId_edition: selected },
        }),
        decision: current,
        deliveries: warnings,
        asset,
        library,
        quarantined,
        journals,
        warningHistory:
          current !== null && warnings.some((row) => row.acceptedAt !== null)
            ? await warningHistory(f.db, current.id)
            : null,
        policyAt,
        sends: f.sent,
      };
    },
    close: f.close,
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
