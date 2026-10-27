import nodePath from "node:path";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import {
  extractEmbeddedSubtitle,
  type MediaProbe,
} from "#filesystem/media-tools.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import { fileOperations } from "./file-operations.ts";
import {
  FileGuardError,
  type FileContext,
  type FilePlanEntry,
  type Transaction,
} from "./types.ts";
import {
  MovieEditionScopeSchema,
  type MovieEditionScope,
} from "#shared/movie-editions/registry.ts";
import { planEmbeddedStreamFacts } from "./subtitle-lifecycle/embedded-facts.ts";
import { currentSubtitlePolicies } from "#infrastructure/subtitle-policy.ts";
import { currentMovieSubtitlePolicies } from "#infrastructure/movie-editions/subtitle-policy.ts";

function embeddedRequestScope(input: {
  mediaIds: string[];
  kind: "movies" | "tv";
  movieScope?: MovieEditionScope;
}) {
  if (input.movieScope === undefined) return effectiveRequestWhere;
  const scope = MovieEditionScopeSchema.parse(input.movieScope);
  if (
    input.kind !== "movies" ||
    input.mediaIds.length !== 1 ||
    input.mediaIds[0] !== scope.mediaId
  )
    throw new FileGuardError("movie_subtitle_scope_changed");
  return {
    edition: scope.edition,
    active: true,
    excluded: false,
    direct: true,
  };
}

export async function stageEmbedded(input: {
  context: FileContext;
  kind: "movies" | "tv";
  source: string;
  probe: MediaProbe;
  mediaIds: string[];
  assetId: string;
  movieScope?: MovieEditionScope;
}): Promise<{
  subtitles: FilePlanEntry["embeddedSubtitles"];
  rejectedStreams: number[];
}> {
  const { context, kind, source, probe, mediaIds, assetId } = input;
  const requestScope = embeddedRequestScope(input);
  if (!probe.streams.some((stream) => extractableStream(stream)))
    return { subtitles: [], rejectedStreams: [] };
  const requests = await context.db.mediaRequest.findMany({
    where: { ...requestScope, mediaId: { in: mediaIds } },
  });
  const wanted = new Set(
    requests.flatMap((request) => request.subtitleLanguages),
  );
  const policies =
    input.movieScope === undefined
      ? await currentSubtitlePolicies(context.db, mediaIds)
      : await currentMovieSubtitlePolicies(context.db, input.movieScope);
  for (const policy of policies)
    for (const target of policy.rules.targets) wanted.add(target.language);
  const roots = context.roots[kind];
  const subtitles: FilePlanEntry["embeddedSubtitles"] = [];
  const rejectedStreams: number[] = [];
  for (const stream of probe.streams) {
    const language = embeddedLanguage(stream.tags?.language);
    if (!eligibleStream(stream, language, wanted, { subtitles, probe }))
      continue;
    if (language === null || stream.codec_name === undefined)
      throw new Error("Eligible stream contract violated");
    await context.checkpoint("extracting-subtitle");
    const extracted = await extractEmbeddedSubtitle({
      path: source,
      streamIndex: stream.index,
      codec: stream.codec_name,
    });
    const filename = `embedded.${extracted.format}`;
    const validation = validateEmbedded(
      extracted.bytes,
      filename,
      language,
      stream.tags?.title ?? "",
    );
    if (validation === null) {
      rejectedStreams.push(stream.index);
      continue;
    }
    const id = crypto.randomUUID();
    await fileOperations(context, roots, () =>
      Promise.reject(new Error("Embedded staging cannot publish")),
    ).readManifest(id);
    const directory = nodePath.join(roots.control, "embedded");
    await mkdir(directory, { recursive: true });
    if ((await realpath(directory)) !== directory)
      throw new FileGuardError("embedded_staging_unsafe");
    const relativePath = `embedded/${assetId}-${id}.${extracted.format}`;
    const bytes = Buffer.from(validation);
    await writeFile(nodePath.join(roots.control, relativePath), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    subtitles.push({
      id,
      language,
      relativePath,
      checksum: createHash("sha256").update(bytes).digest("hex"),
      format: extracted.format,
      streamIndex: stream.index,
    });
  }
  return { subtitles, rejectedStreams };
}

function embeddedLanguage(language = ""): "en" | "zh-Hans" | null {
  if (["en", "eng"].includes(language)) return "en";
  return ["zh", "zho", "chi", "zh-Hans", "zh-CN"].includes(language)
    ? "zh-Hans"
    : null;
}

function extractableStream(stream: MediaProbe["streams"][number]): boolean {
  return (
    stream.codec_type === "subtitle" &&
    embeddedLanguage(stream.tags?.language) !== null &&
    ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"].includes(
      stream.codec_name ?? "",
    )
  );
}

function eligibleStream(
  stream: MediaProbe["streams"][number],
  language: "en" | "zh-Hans" | null,
  wanted: Set<string>,
  {
    subtitles: found,
    probe,
  }: { subtitles: FilePlanEntry["embeddedSubtitles"]; probe: MediaProbe },
): boolean {
  return (
    extractableStream(stream) &&
    language !== null &&
    wanted.has(language) &&
    !found.some((item) => {
      const previous = probe.streams.find(
        (row) => row.index === item.streamIndex,
      );
      if (previous === undefined)
        throw new Error("Extracted subtitle stream disappeared");
      return (
        item.language === language &&
        previous.disposition?.forced === stream.disposition?.forced &&
        previous.disposition?.hearing_impaired ===
          stream.disposition?.hearing_impaired
      );
    })
  );
}

function validateEmbedded(
  bytes: Uint8Array,
  filename: string,
  language: string,
  title: string,
): string | null {
  // Malformed or ambiguous subtitle content is an expected provider boundary rejection.
  try {
    return validateSubtitle({
      bytes,
      filename,
      requireSimplified: language === "zh-Hans",
      provenanceText: title,
    }).text;
  } catch {
    return null;
  }
}

export async function commitEmbedded(input: {
  context: FileContext;
  tx: Transaction;
  entry: FilePlanEntry;
  recoveryEpoch: number;
  movieScope?: MovieEditionScope;
}): Promise<void> {
  const { context, tx, entry, recoveryEpoch } = input;
  const facts = planEmbeddedStreamFacts(entry);
  for (const subtitle of entry.embeddedSubtitles) {
    const observed = facts?.streams.find(
      (row) => row.subtitleId === subtitle.id,
    );
    const path = nodePath.join(
      context.roots[entry.libraryKind].control,
      subtitle.relativePath,
    );
    const prepared = context.preparedEmbedded?.get(subtitle.id);
    if (
      prepared?.path !== path ||
      prepared.checksum !== subtitle.checksum ||
      context.contentProof === undefined ||
      (await context.contentProof.digest(path)) !== subtitle.checksum
    )
      throw new FileGuardError("embedded_content_changed");
    await tx.subtitleAsset.upsert({
      where: { id: subtitle.id },
      update: {},
      create: {
        id: subtitle.id,
        assetId: entry.assetId,
        language: subtitle.language,
        providerId: "embedded",
        state: "validated",
        qualityStatus: "accepted",
        storageKind: "sidecar",
        ownershipEpoch: recoveryEpoch,
        checksum: subtitle.checksum,
        videoChecksum: entry.checksum,
        videoVersion: 0,
        content: new Uint8Array(prepared.bytes),
        ...(observed === undefined
          ? {}
          : {
              forced: observed.forced,
              hearingImpaired: observed.hearingImpaired,
            }),
        provenance: {
          filename: `embedded.${subtitle.format}`,
          description: "Embedded text track from the exact imported video",
          format: subtitle.format,
          streamIndex: subtitle.streamIndex,
          checksum: subtitle.checksum,
        },
        matchingEvidence: {
          ...(facts === undefined || observed === undefined
            ? {}
            : {
                embeddedSourceV2: {
                  schemaVersion: 2,
                  probeHash: facts.probeHash,
                  streamIndex: observed.streamIndex,
                },
              }),
          ...(input.movieScope === undefined
            ? {}
            : {
                schemaVersion: 4,
                movieScope: MovieEditionScopeSchema.parse(input.movieScope),
              }),
          assetVersion: 0,
          assetChecksum: entry.checksum,
          exactMediaMatch: true,
          videoVersionMatch: true,
          recoveryEpoch,
          generations: entry.generations,
        },
      },
    });
  }
}
