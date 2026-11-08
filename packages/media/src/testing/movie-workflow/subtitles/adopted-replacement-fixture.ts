import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { libraryBindingFixture } from "#automation/plex-binding/library.test-fixture.ts";
import { verifyLibraryPlexBinding } from "#automation/plex-binding/library.ts";
import { LibraryPlexBindingInputV1Schema } from "#shared/plex-binding/activities.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { testPublicationExecution } from "#testing/publication-execution.ts";
import { MovieLifecycleCommands } from "#infrastructure/movie-editions/lifecycle/commands.ts";
import { PrismaMediaApplication } from "#infrastructure/media-service.ts";
import { PrismaMovieSubtitleReplacements } from "#infrastructure/movie-editions/subtitle-replacement/service.ts";
import { createMovieSubtitleReplacementFileFacet } from "#automation/movie-editions/subtitle-replacement/facet.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { authenticateMovieFixtureOwner } from "#testing/movie-workflow/owner-pin.ts";
import { enableMovieFixtureEmail } from "#testing/movie-workflow/personal-email.ts";

/** Genuine initial-library caption adoption followed by new explicit personal consent and owner review. */
export async function createAdoptedMovieReplacementFixture(bytes: Uint8Array) {
  const cluster = await startMediaTestPostgres();
  const directories: string[] = [];
  let email: Awaited<ReturnType<typeof enableMovieFixtureEmail>> | undefined;
  const close = async () => {
    await email?.close();
    await cluster.close();
    for (const directory of directories)
      await rm(directory, { recursive: true, force: true });
  };
  try {
    const db = cluster.database;
    const oldText =
      "1\n00:00:00,000 --> 00:00:01,500\nActual initial-library caption awaiting owner quality confirmation.\n";
    const f = await libraryBindingFixture(
      db,
      "directors_cut",
      (directory) => directories.push(directory),
      {
        bytes,
        initialSidecars: [{ language: "en", bytes: Buffer.from(oldText) }],
      },
    );
    const owner = await authenticateMovieFixtureOwner(
      f.context,
      f.network.actor,
    );
    email = await enableMovieFixtureEmail(f.context, owner);
    const sections = await f.context.permittedSections();
    const settings = {
      keepDays: 30,
      serverMachineId: z.string().min(1).parse(f.context.serverMachineId),
      movieSectionId: sections.movie,
    };
    const scope = {
      rootMediaId: f.network.media.id,
      mediaId: f.network.media.id,
      edition: "directors_cut" as const,
    };
    const queued = await db.operation.findUniqueOrThrow({
      where: { idempotencyKey: `library-plex:${f.receiptId}:${f.asset.id}:0` },
    });
    const bound = await verifyLibraryPlexBinding(
      f.context,
      LibraryPlexBindingInputV1Schema.parse(queued.payload),
      testPlexBindingExecution(),
    );
    if (bound.status !== "verified")
      throw new Error("Actual adopted movie Plex binding did not verify");
    const commands = new MovieLifecycleCommands(db, settings);
    const choice = await new PrismaMediaApplication(
      db,
      settings,
    ).getMovieEditionContext(owner, scope.mediaId, owner.id);
    const option = choice.options.find(
      (value) => value.edition === scope.edition,
    );
    if (option?.request !== null)
      throw new Error(
        "Actual library adoption must precede any personal request",
      );
    const request = await commands.requestMovieEditionV4(
      owner,
      crypto.randomUUID(),
      {
        schemaVersion: 4,
        mediaId: scope.mediaId,
        subjectUserId: owner.id,
        expected: {
          mediaVersion: choice.mediaVersion,
          targetVersion: option.targetVersion,
          definition: option.storedDefinition,
          request: null,
        },
        selection: {
          edition: scope.edition,
          definitionVersion: option.definitionVersion,
          definitionDigest: option.definitionDigest,
          registryVersion: choice.registryVersion,
        },
        options: { subtitleLanguages: ["en"] },
      },
    );
    const asset = await db.libraryAsset.findUniqueOrThrow({
      where: { id: f.asset.id },
    });
    const old = await db.subtitleAsset.findFirstOrThrow({
      where: {
        assetId: asset.id,
        state: "installed",
        storageKind: "sidecar",
        language: "en",
      },
    });
    if (old.qualityStatus !== "unverified")
      throw new Error(
        "Actual initial-library caption quality must stay unverified",
      );
    const service = new PrismaMovieSubtitleReplacements(
      db,
      settings,
      f.context.describeWorkflow,
    );
    const text =
      "1\n00:00:00,000 --> 00:00:01,500\nActual owner-corrected human caption for this exact adopted cut.\n";
    const upload = await service.upload(owner, crypto.randomUUID(), {
      schemaVersion: 2,
      scope,
      assetId: asset.id,
      expectedAssetVersion: asset.version,
      expectedChecksum: z.string().parse(asset.checksum),
      language: "en",
      forced: false,
      hearingImpaired: false,
      filename: "corrected-adopted.srt",
      description:
        "Owner verified human correction for this exact adopted movie",
      contentBase64: Buffer.from(text).toString("base64"),
      declaredEncoding: "utf8",
      confirmedMatchingVideo: true,
      replacementFor: {
        oldSubtitleId: old.id,
        expectedOldVersion: old.version,
      },
    });
    const candidate = await db.subtitleAsset.findUniqueOrThrow({
      where: { id: z.uuid().parse(upload.subtitleId) },
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
    const facet = createMovieSubtitleReplacementFileFacet(f.files);
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
        include: { receipt: true, review: true },
      });
    const approve = async () => {
      const ready = await invoke("prepareSubtitleReplacement", prepareInput);
      if (ready.state !== "ready")
        throw new Error(
          `Actual adopted caption preparation protected: ${JSON.stringify(ready)}`,
        );
      const current = await row();
      const applied = await service.review.apply(
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
        operationId: z.uuid().parse(applied.operationId),
        movieScope: scope,
      };
    };
    return {
      db,
      original: f,
      context: email.context,
      messages: email.messages,
      files: f.files,
      scope,
      owner,
      commands,
      request,
      asset,
      old,
      oldText,
      candidate,
      text,
      service,
      prepareInput,
      invoke,
      row,
      approve,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
