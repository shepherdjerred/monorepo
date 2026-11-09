import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { z } from "zod";
import { createMovieHistoryHttpFixture } from "./history-http-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { enableMovieFixtureEmail } from "#testing/movie-workflow/personal-email.ts";
import { movieWorkflowWire } from "#testing/movie-workflow/wire.ts";
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
import { physicalFile } from "#testing/movie-workflow/physical-file.ts";

/** Real initial scanner/adoption, HTTP household release, and Files/Network runtime; policy alone advances. */
export async function createMovieHistoryReviewWorkflowFixture(
  startWorkflow: WorkflowStarter,
) {
  const bytes = await movieVideoFixture();
  const f = await createMovieHistoryHttpFixture("directors_cut", bytes, {
    actualMovieExclusion: true,
    canonicalStorage: true,
    startWorkflow,
  });
  let email: Awaited<ReturnType<typeof enableMovieFixtureEmail>> | undefined;
  try {
    const part = f.original.item().Media?.[0]?.Part[0];
    if (part === undefined) throw new Error("Actual adopted Plex Part missing");
    const wire = movieWorkflowWire(f.db, {
      mediaId: f.scope.mediaId,
      edition: f.scope.edition,
      downloads: f.original.files.roots.movies.downloads,
      bytes,
      ratingKey: f.original.item().ratingKey,
      partId: part.id,
      playback: { viewCount: 3, lastViewedAt: 1_234_567, viewOffset: 456_000 },
    });
    email = await enableMovieFixtureEmail(
      { ...f.original.context, plex: wire.plex, userPlex: wire.userPlex },
      f.member,
    );
    const observedReceipts = new Map<string, string>();
    const mail = email;
    let policyAt: number | null = null;
    const now = () => new Date(Math.max(Date.now(), policyAt ?? 0));
    const context = {
      ...mail.context,
      now,
      notify: async (...args: Parameters<typeof mail.context.notify>) => {
        const accepted = await mail.context.notify(...args);
        observedReceipts.set(accepted.receipt, args[0].recipient);
        return accepted;
      },
      reconcileNotification: (input: { receipt: string }) =>
        Promise.resolve({
          status: observedReceipts.has(input.receipt)
            ? ("delivered" as const)
            : ("unknown" as const),
          recipient: observedReceipts.get(input.receipt) ?? null,
        }),
    };
    const selected = { mediaId: f.scope.mediaId, edition: f.scope.edition };
    const decision = () =>
      f.db.retentionDecision.findFirst({
        where: { ...selected, generation: f.input.generation },
        orderBy: { createdAt: "desc" },
      });
    const warnings = () =>
      f.db.notificationDelivery.findMany({
        where: {
          userId: f.member.id,
          event: {
            kind: "retention_warning",
            mediaId: f.scope.mediaId,
            payload: { path: ["scope", "edition"], equals: f.scope.edition },
          },
        },
        include: { event: true },
        orderBy: { id: "asc" },
      });
    const completion = createOutboxActivities(f.db, () =>
      Promise.reject(
        new Error("Operation completion cannot invent a workflow dispatch"),
      ),
    );
    return {
      input: f.input,
      scope: f.scope,
      baseline: f.baseline,
      choice: f.choice,
      request: f.request,
      reviewId: f.detail.id,
      movie: createMovieNetworkFacetV4(context),
      fileMovie: createMovieFileFacetV4({ ...f.original.files, now }),
      ...createPlexRuntimeFacets(context, () => Promise.resolve(false)),
      finishMediaOperation: completion.finishMediaOperation,
      dispatch: (start: WorkflowStarter) =>
        createOutboxActivities(f.db, start).dispatchMediaOutbox(),
      async advancePolicyFromActualState() {
        const current = await decision();
        if (current?.state === "quarantined") {
          const committed = z.date().parse(current.quarantinedAt).getTime();
          if (committed > Date.now())
            throw new Error(
              "Quarantine commit escaped its real authority clock",
            );
          policyAt = committed + 8 * 86_400_000;
          return;
        }
        const deliveries = await warnings();
        const accepted = deliveries.filter(
          (row) => row.state === "accepted" && row.acceptedAt !== null,
        );
        if (accepted.length === 0) return;
        const committed = Math.max(
          ...accepted.map((row) => z.date().parse(row.acceptedAt).getTime()),
        );
        if (committed > Date.now())
          throw new Error("Warning receipt escaped its real authority clock");
        policyAt = committed + 7 * 86_400_000 + 1;
      },
      async warningOperationIds() {
        const deliveries = await warnings();
        const operations = await f.db.operation.findMany({
          where: {
            kind: "deliver_notification",
            targetId: { in: deliveries.map((row) => row.id) },
          },
          orderBy: { id: "asc" },
        });
        return operations.map((row) => row.id);
      },
      async evidence() {
        const current = await decision();
        const manifest =
          current?.manifest == null
            ? null
            : RemovalPlanSchema.parse(current.manifest);
        const journalRoot = f.original.files.roots.movies.control;
        const names = (await exists(path.join(journalRoot, "journal")))
          ? await readdir(path.join(journalRoot, "journal"))
          : [];
        // saveManifest writes `<name>.json.tmp` and renames it into place, so
        // only installed `.json` entries are journals; a listed temporary
        // can be renamed away before it is read.
        const journals = await Promise.all(
          names
            .filter(
              (name) =>
                name.startsWith(`${f.input.operationId}-`) &&
                name.endsWith(".json"),
            )
            .sort()
            .map(async (name) =>
              ManifestSchema.parse(
                JSON.parse(
                  await readFile(
                    path.join(journalRoot, "journal", name),
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
          decision: current,
          warnings: await warnings(),
          journals,
          messages: [...mail.messages],
          additions: wire.additions(),
          review: await f.db.recoveryReview.findUniqueOrThrow({
            where: { id: f.detail.id },
          }),
          receipt: await f.db.recoveryReleaseReceipt.findUniqueOrThrow({
            where: { reviewId: f.detail.id },
          }),
          hold: await f.db.recoveryHold.findUniqueOrThrow({
            where: { mediaId_edition: selected },
          }),
          request: await f.db.mediaRequest.findUniqueOrThrow({
            where: { id: f.request.id },
          }),
          choice: await f.db.movieEditionChoice.findUniqueOrThrow({
            where: { id: f.choice.id },
          }),
          asset: await f.db.libraryAsset.findUniqueOrThrow({
            where: { id: f.baseline.asset.id },
          }),
          handoff: await f.db.mediaHandoffReceipt.findUniqueOrThrow({
            where: { id: f.baseline.handoff.id },
          }),
          library: await physicalFile(
            workerFilePath(f.original.files, f.baseline.asset.path),
          ),
          quarantine: await Promise.all(
            (manifest?.assets ?? []).flatMap((entry) =>
              [entry, ...entry.sidecars].map((file) =>
                physicalFile(
                  path.join(journalRoot, "quarantine", file.quarantineId),
                ),
              ),
            ),
          ),
          httpErrors: [...f.http.errors],
          policyAt,
        };
      },
      close: async () => {
        try {
          await mail.close();
        } finally {
          await f.close();
        }
      },
    };
  } catch (error) {
    try {
      await email?.close();
    } finally {
      await f.close();
    }
    throw error;
  }
}
