import { z } from "zod";
import { createPublishedMovieFixture } from "#testing/movie-workflow/upgrade-fixture.ts";
import { createRestoredMovieFixture } from "#testing/movie-workflow/restore-fixture.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { PrismaMovieSubtitleReplacements } from "#infrastructure/movie-editions/subtitle-replacement/service.ts";
import { createMovieSubtitleReplacementFileFacet } from "#automation/movie-editions/subtitle-replacement/facet.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { publishRestoredMovieToPlexV4 } from "#automation/movie-editions/retention/restore-plex.ts";
import { MovieEditionScopeSchema } from "#shared/movie-editions/registry.ts";
import type { Database } from "#infrastructure/database.ts";

async function replacementVideo(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  restored: boolean,
) {
  if (!restored) return createPublishedMovieFixture(edition, bytes);
  const f = await createRestoredMovieFixture(edition, bytes);
  try {
    await publishRestoredMovieToPlexV4(
      f.context,
      f.input,
      testPlexBindingExecution(),
    );
    return f;
  } catch (error) {
    await f.close();
    throw error;
  }
}

/** Genuine video, installed caption receipt and owner-produced candidate; no history is manufactured. */
export async function createMovieReplacementFixture(
  edition: MovieEditionKey,
  bytes: Uint8Array,
  options: {
    restored?: boolean;
    commandDatabase?: (source: Database) => Promise<Database>;
  } = {},
) {
  const f = await replacementVideo(edition, bytes, options.restored === true);
  try {
    const { db, context, files } = f.source;
    const commandDatabase =
      options.commandDatabase === undefined
        ? db
        : await options.commandDatabase(db);
    const scope = MovieEditionScopeSchema.parse({
      rootMediaId: f.asset.editionRootId,
      mediaId: f.asset.editionRootId,
      edition,
    });
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    });
    const owner = await db.mediaUser.findFirstOrThrow({
      where: { role: "owner", restricted: false },
    });
    const old = await db.subtitleAsset.findFirstOrThrow({
      where: {
        assetId: asset.id,
        state: "installed",
        storageKind: "sidecar",
        language: "en",
      },
    });
    const sections = await context.permittedSections();
    const describe = { current: context.describeWorkflow };
    const service = new PrismaMovieSubtitleReplacements(
      commandDatabase,
      {
        keepDays: 30,
        serverMachineId: z.string().min(1).parse(context.serverMachineId),
        movieSectionId: sections.movie,
      },
      (id) => describe.current(id),
    );
    const text =
      "1\n00:00:00,000 --> 00:00:01,500\nCorrected synthetic human caption dialogue.\n";
    const uploaded = await service.upload(owner, crypto.randomUUID(), {
      schemaVersion: 2,
      scope,
      assetId: asset.id,
      expectedAssetVersion: asset.version,
      expectedChecksum: z.string().parse(asset.checksum),
      language: "en",
      forced: z.boolean().parse(old.forced),
      hearingImpaired: z.boolean().parse(old.hearingImpaired),
      filename: "owner-corrected.srt",
      description: "Owner verified human captions for this exact movie cut",
      contentBase64: Buffer.from(text).toString("base64"),
      declaredEncoding: "utf8",
      confirmedMatchingVideo: true,
      replacementFor: {
        oldSubtitleId: old.id,
        expectedOldVersion: old.version,
      },
    });
    const candidate = await db.subtitleAsset.findUniqueOrThrow({
      where: { id: z.uuid().parse(uploaded.subtitleId) },
    });
    const prepared = await service.prepare(owner, crypto.randomUUID(), {
      schemaVersion: 2,
      scope,
      oldSubtitleId: old.id,
      candidateSubtitleId: candidate.id,
      expectedOldVersion: old.version,
      expectedCandidateVersion: candidate.version,
    });
    const replacementId = z.uuid().parse(prepared.subtitleReplacementId);
    const prepareInput = {
      replacementId,
      operationId: z.uuid().parse(prepared.operationId),
      movieScope: scope,
    };
    const facet = createMovieSubtitleReplacementFileFacet(files.context);
    const invoke = (
      phase: Parameters<typeof facet>[0],
      input: Parameters<typeof facet>[1],
    ) =>
      facet(phase, input, {
        execution: testPublicationExecution(),
        budget: new PublicationAuthorityReadBudget(),
      });
    const row = () =>
      db.subtitleReplacement.findUniqueOrThrow({
        where: { id: replacementId },
        include: { review: true, receipt: true },
      });
    const approve = async () => {
      const ready = await invoke("prepareSubtitleReplacement", prepareInput);
      if (ready.state !== "ready")
        throw new Error(
          `Actual movie replacement preparation failed: ${JSON.stringify(ready)}`,
        );
      const current = await row();
      const command = await service.review.apply(
        owner,
        crypto.randomUUID(),
        replacementId,
        {
          expectedVersion: current.version,
          observationHash: z.string().parse(current.review?.observationHash),
          acknowledgeReplacement: true,
        },
      );
      return {
        replacementId,
        operationId: z.uuid().parse(command.operationId),
        movieScope: scope,
      };
    };
    return {
      db,
      commandDatabase,
      source: f.source,
      original: f,
      asset,
      old,
      candidate,
      owner,
      scope,
      text,
      service,
      describe,
      prepareInput,
      row,
      invoke,
      approve,
      close: f.close,
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
