import path from "node:path";
import { z } from "zod";
import { Prisma } from "#generated/prisma/client.ts";
import { MediaError } from "#application/errors.ts";
import { BundleReportSchema } from "#shared/migration-handoff.ts";
import type { PrepareLibraryHandoffV2Schema } from "#shared/handoff-v2.ts";
import {
  LibraryHandoffScopeProtocolSchema,
  type PrepareLibraryHandoffProtocolSchema,
  type LibraryHandoffScope,
} from "#shared/handoff/protocol.ts";
import { analyzeCutTexts } from "#domain/editions/parse.ts";
import { conventionalMovieCutTexts } from "#domain/editions/parse-v2.ts";
import { movieCutMatches } from "#shared/movie-editions/cut-v2.ts";
import {
  movieDefinitionRef,
  matchesMovieDefinition,
} from "#infrastructure/movie-editions/definition.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { canonicalReferences } from "#infrastructure/acquisition-identity/references.ts";
import { buildHandoffScope } from "./scope.ts";

const conflict = (code: string) =>
  new MediaError(
    code,
    "Initial library adoption requires an exact file classification and no existing Media owner",
    409,
  );

/** Classify before the first physical owner. No requester or transfer authority is created. */
export async function buildLibraryHandoffScope(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof PrepareLibraryHandoffProtocolSchema>,
): Promise<LibraryHandoffScope> {
  const review = await tx.migrationBundleReview.findUniqueOrThrow({
    where: { id: input.bundleReviewId },
  });
  const report = BundleReportSchema.parse(review.report);
  const selected = report.entries.filter((entry) =>
    input.selected.some(
      (selection) => selection.provenanceKey === entry.provenanceKey,
    ),
  );
  assertLibrarySelection(selected, input);
  const base = await buildHandoffScope(tx, librarySourceRequest(input));
  const files = [];
  for (const file of base.files) {
    if (file.existingAssetId !== null)
      throw conflict("library_asset_already_managed");
    const classification =
      file.libraryKind === "movies"
        ? await classifyMovie(tx, { input, file, report })
        : null;
    files.push({
      ...file,
      edition: classification?.edition ?? "default",
      classification: classification?.evidence ?? null,
    });
  }
  if (
    input.movies.length !==
    files.filter((file) => file.libraryKind === "movies").length
  )
    throw conflict("library_classification_selection_changed");
  await tx.$queryRaw(
    Prisma.sql`SELECT "mediaId", edition FROM "MediaIntent" WHERE "mediaId" IN (${Prisma.join(base.media.map((item) => item.mediaId))}) ORDER BY "mediaId", edition FOR UPDATE`,
  );
  const scopes = new Map<
    string,
    {
      mediaId: string;
      edition: LibraryHandoffScope["targets"][number]["edition"];
    }
  >();
  for (const file of files)
    for (const mediaId of file.mediaIds)
      scopes.set(`${mediaId}:${file.edition}`, {
        mediaId,
        edition: file.edition,
      });
  // Media-only selections still preserve their TV/default monitoring metadata.
  for (const media of base.media)
    if (!files.some((file) => file.mediaIds.includes(media.mediaId)))
      scopes.set(`${media.mediaId}:default`, {
        mediaId: media.mediaId,
        edition: "default",
      });
  const targets = [];
  for (const scope of scopes.values()) {
    const current = await tx.mediaIntent.findUnique({
      where: { mediaId_edition: scope },
    });
    targets.push({
      ...scope,
      generation: current?.generation ?? null,
      version: current?.version ?? null,
    });
  }
  return LibraryHandoffScopeProtocolSchema.parse({
    ...base,
    schemaVersion: input.schemaVersion,
    request: input,
    files,
    targets,
  });
}

function assertLibrarySelection(
  selected: z.infer<typeof BundleReportSchema>["entries"],
  input: z.infer<typeof PrepareLibraryHandoffProtocolSchema>,
) {
  if (
    selected.some(
      (entry) =>
        entry.observationHash !==
        snapshotHash(z.json().parse(entry.sourceRecord)),
    )
  )
    throw conflict("library_capture_evidence_changed");
  if (
    selected.some(
      (entry) =>
        !["media", "file", "subtitle", "subtitle_preference"].includes(
          entry.kind,
        ),
    )
  )
    throw conflict("library_handoff_selection_unsupported");
  if (
    new Set(input.movies.map((item) => item.provenanceKey)).size !==
    input.movies.length
  )
    throw conflict("library_classification_duplicate");
}

async function classifyMovie(
  tx: Prisma.TransactionClient,
  options: {
    input: z.infer<typeof PrepareLibraryHandoffProtocolSchema>;
    file: Awaited<ReturnType<typeof buildHandoffScope>>["files"][number];
    report: z.infer<typeof BundleReportSchema>;
  },
) {
  const { input, file, report } = options;
  const resolution = input.movies.find(
    (item) => item.provenanceKey === file.provenanceKey,
  );
  const entry = report.entries.find(
    (item) => item.provenanceKey === file.provenanceKey,
  );
  const media = await tx.mediaItem.findUniqueOrThrow({
    where: { id: z.uuid().parse(file.mediaIds[0]) },
  });
  if (
    resolution === undefined ||
    entry === undefined ||
    file.mediaIds.length !== 1 ||
    media.kind !== "movie"
  )
    throw conflict("library_movie_classification_required");
  const aliases = canonicalReferences(media).aliases;
  const canonical = {
    rootMediaId: media.id,
    title: media.title,
    aliases,
    digest: snapshotHash({
      id: media.id,
      version: media.version,
      title: media.title,
      aliases,
      tmdbId: media.tmdbId,
      externalIds: z.json().parse(media.externalIds),
    }),
  };
  const analysis = conventionalMovieCutTexts(
    analyzeCutTexts({
      canonical,
      attribution: "legacy_primary",
      texts: [
        {
          text: path.basename(file.sourcePath),
          provenance: { kind: "release-title", field: "sourceFileName" },
        },
      ],
    }),
  );
  if (
    resolution.resolution.kind === "conventional" &&
    !movieCutMatches(resolution.edition, analysis.conclusion)
  )
    throw conflict("library_movie_classification_requires_review");
  const definition = movieDefinitionRef(media.id, resolution.edition);
  const stored = await tx.mediaEditionDefinition.findUnique({
    where: {
      rootMediaId_key: { rootMediaId: media.id, key: resolution.edition },
    },
  });
  if (stored !== null && !matchesMovieDefinition(stored, definition.definition))
    throw conflict("library_movie_definition_changed");
  return {
    edition: resolution.edition,
    evidence: {
      schemaVersion: 1 as const,
      parserVersion: "cut-markers-v2" as const,
      provenanceKey: file.provenanceKey,
      observationHash: entry.observationHash,
      canonicalDigest: canonical.digest,
      ...analysis,
      resolution: resolution.resolution,
      definition: {
        definitionVersion: definition.definitionVersion,
        definitionDigest: definition.definitionDigest,
      },
    },
  };
}

/** Source projection only; the complete versioned request remains in the final owner scope. */
function librarySourceRequest(
  input: z.infer<typeof PrepareLibraryHandoffProtocolSchema>,
): ReturnType<typeof librarySourceRequestV2> {
  if (input.schemaVersion === 3) {
    const { plexEditionLabels: _labels, ...source } = input;
    return librarySourceRequestV2({ ...source, schemaVersion: 2 });
  }
  return librarySourceRequestV2(input);
}
function librarySourceRequestV2(
  input: z.infer<typeof PrepareLibraryHandoffV2Schema>,
) {
  const { schemaVersion: _version, movies: _movies, ...source } = input;
  return source;
}
