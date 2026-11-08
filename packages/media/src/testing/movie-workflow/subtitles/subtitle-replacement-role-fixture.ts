import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { createMovieReplacementFixture } from "./subtitle-replacement-fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { createMovieSubtitleReplacementFileFacet } from "#automation/movie-editions/subtitle-replacement/facet.ts";
import { createSubtitleReplacementNetworkActivities } from "#infrastructure/subtitle-replacement/activities.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { replacementPaths } from "#automation/subtitle-replacement/files.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";

const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const Input = z.object({
  replacementId: z.uuid(),
  operationId: z.uuid(),
  movieScope: MovieEditionScopeSchema,
});

/** Native Temporal descriptions are the only terminal-workflow authority supplied to owner reconciliation. */
export async function createMovieReplacementRoleFixture(
  describe: MediaAutomationContext["describeWorkflow"],
) {
  const f = await createMovieReplacementFixture(
    "directors_cut",
    await movieVideoFixture(),
  );
  f.describe.current = describe;
  let unavailable = false;
  let publications = 0;
  let receiptInterruptions = 0;
  const movieReplacement = createMovieSubtitleReplacementFileFacet({
    ...f.source.files.context,
    checkpoint: (phase) => {
      if (phase === "published") publications++;
      if (phase === "subtitle-replacement-before-receipt" && unavailable) {
        receiptInterruptions++;
        throw new Error(
          "Synthetic caption receipt boundary unavailable after actual native swap",
        );
      }
      return Promise.resolve();
    },
  });
  const completion = createOutboxActivities(f.db, () =>
    Promise.reject(new Error("Completion cannot dispatch")),
  );
  const originalCommands = await f.db.operation.findMany({
    where: { kind: "acquire_movie_subtitles_v4" },
    orderBy: { id: "asc" },
  });
  const originalPublications = await f.db.mediaPublicationTransition.findMany({
    orderBy: { id: "asc" },
  });
  async function workflowInput(operationId: string) {
    const operation = await f.db.operation.findUniqueOrThrow({
      where: { id: operationId },
      include: { outbox: true },
    });
    if (
      operation.outbox === null ||
      identity(operation.payload) !== identity(operation.outbox.payload)
    )
      throw new Error("Actual replacement command lost its exact outbox body");
    const body = z.record(z.string(), z.json()).parse(operation.payload);
    return { ...body, ...Input.parse(body) };
  }
  return {
    prepareInput: f.prepareInput,
    scope: f.scope,
    movieReplacement,
    network: createSubtitleReplacementNetworkActivities(f.db),
    finishMediaOperation: completion.finishMediaOperation,
    workflowInput,
    interruptReceipt: () => {
      unavailable = true;
    },
    async approve() {
      const row = await f.row();
      if (row.state !== "awaiting_review" || row.review === null)
        throw new Error(
          "Native preparation did not produce its actual owner review",
        );
      const command = await f.service.review.apply(
        f.owner,
        crypto.randomUUID(),
        row.id,
        {
          expectedVersion: row.version,
          observationHash: row.review.observationHash,
          acknowledgeReplacement: true,
        },
      );
      return workflowInput(z.uuid().parse(command.operationId));
    },
    async recover() {
      unavailable = false;
      const row = await f.row();
      const command = await f.service.review.reconcile(
        f.owner,
        crypto.randomUUID(),
        row.id,
        { expectedVersion: row.version },
      );
      return workflowInput(z.uuid().parse(command.operationId));
    },
    async evidence() {
      const row = await f.row();
      const paths = replacementPaths(f.source.files.context, row);
      const video = await readFile(paths.video);
      return {
        row,
        video: { checksum: hash(video), size: video.byteLength },
        originalVideo: {
          checksum: hash(f.source.bytes),
          size: f.source.bytes.byteLength,
        },
        target: hash(await readFile(paths.target)),
        oldChecksum: f.old.checksum,
        newChecksum: f.candidate.checksum,
        publications,
        receiptInterruptions,
        journal: await readFile(
          path.join(
            paths.roots.control,
            "journal",
            `${row.importOperationId}.json`,
          ),
          "utf8",
        ).catch((error: unknown) => {
          if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
            return null;
          throw error;
        }),
        sourceCommands: await f.db.operation.findMany({
          where: { id: { in: originalCommands.map((command) => command.id) } },
          orderBy: { id: "asc" },
        }),
        originalCommands,
        sourcePublications: await f.db.mediaPublicationTransition.findMany({
          orderBy: { id: "asc" },
        }),
        originalPublications,
        asset: await f.db.libraryAsset.findUniqueOrThrow({
          where: { id: f.asset.id },
        }),
        originalAsset: f.asset,
        operations: await f.db.operation.findMany({
          where: { targetId: row.id },
          orderBy: { createdAt: "asc" },
        }),
        choices: await f.db.movieEditionChoice.findMany({
          where: { rootMediaId: f.scope.mediaId },
          orderBy: { id: "asc" },
        }),
        requests: await f.db.mediaRequest.findMany({
          where: { mediaId: f.scope.mediaId },
          orderBy: { id: "asc" },
        }),
        adds: f.source.wire.additions(),
      };
    },
    close: f.close,
  };
}

function identity(value: unknown) {
  return identityHash(z.json().parse(value));
}
