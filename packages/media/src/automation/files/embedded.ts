import nodePath from "node:path";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile, readFile } from "node:fs/promises";
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

export async function stageEmbedded(input: {
  context: FileContext;
  kind: "movies" | "tv";
  source: string;
  probe: MediaProbe;
  mediaIds: string[];
  assetId: string;
}): Promise<{
  subtitles: FilePlanEntry["embeddedSubtitles"];
  rejectedStreams: number[];
}> {
  const { context, kind, source, probe, mediaIds, assetId } = input;
  const requests = await context.db.mediaRequest.findMany({
    where: { mediaId: { in: mediaIds }, active: true },
  });
  const wanted = new Set(
    requests.flatMap((request) => request.subtitleLanguages),
  );
  const roots = context.roots[kind];
  const subtitles: FilePlanEntry["embeddedSubtitles"] = [];
  const rejectedStreams: number[] = [];
  for (const stream of probe.streams) {
    const language = embeddedLanguage(stream.tags?.language);
    if (!eligibleStream(stream, language, wanted, subtitles)) continue;
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

function eligibleStream(
  stream: MediaProbe["streams"][number],
  language: "en" | "zh-Hans" | null,
  wanted: Set<string>,
  found: FilePlanEntry["embeddedSubtitles"],
): boolean {
  return (
    stream.codec_type === "subtitle" &&
    language !== null &&
    wanted.has(language) &&
    !found.some((item) => item.language === language) &&
    ["subrip", "ass", "ssa", "webvtt", "mov_text", "text"].includes(
      stream.codec_name ?? "",
    )
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
}): Promise<void> {
  const { context, tx, entry, recoveryEpoch } = input;
  for (const subtitle of entry.embeddedSubtitles) {
    const path = nodePath.join(
      context.roots[entry.libraryKind].control,
      subtitle.relativePath,
    );
    if ((await realpath(path)) !== path)
      throw new FileGuardError("embedded_staging_unsafe");
    const bytes = await readFile(path);
    if (createHash("sha256").update(bytes).digest("hex") !== subtitle.checksum)
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
        content: bytes,
        provenance: {
          filename: `embedded.${subtitle.format}`,
          description: "Embedded text track from the exact imported video",
          format: subtitle.format,
          streamIndex: subtitle.streamIndex,
          checksum: subtitle.checksum,
        },
        matchingEvidence: {
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
