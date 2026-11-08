import nodePath from "node:path";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, realpath, lstat } from "node:fs/promises";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import { subtitleDestination } from "#domain/subtitle-path.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { libraryLocation } from "#automation/files/removal-plan.ts";
import { fileOperations } from "#automation/files/file-operations.ts";

/** Normalize and stage outside PG; neither staging callback can publish library bytes. */
export async function stageSubtitleContent(
  context: PublicationContext,
  subtitle: Prisma.SubtitleAssetGetPayload<{ include: { asset: true } }>,
  operationId: string,
) {
  const provenance = z
    .object({
      filename: z.string(),
      description: z.string(),
      format: z.enum(["srt", "ass", "ssa", "vtt"]),
    })
    .loose()
    .parse(subtitle.provenance);
  if (subtitle.content === null)
    throw new FileGuardError("subtitle_content_missing");
  const validated = validateSubtitle({
    bytes: subtitle.content,
    filename: provenance.filename,
    requireSimplified: ["zh-CN", "zh-Hans"].includes(subtitle.language),
    provenanceText: provenance.description,
  });
  if (validated.format !== provenance.format)
    throw new FileGuardError("subtitle_format_mismatch");
  const bytes = Buffer.from(validated.text);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== subtitle.checksum)
    throw new FileGuardError("subtitle_content_changed");
  const location = libraryLocation(context, subtitle.asset.path);
  const roots = context.roots[location.libraryKind];
  const files = fileOperations(
    context,
    { ...roots, downloads: roots.control },
    () => Promise.reject(new Error("Subtitle staging cannot publish")),
  );
  // Reading a journal checks the configured Plex exclusion before any control-root write.
  await files.readManifest(operationId);
  const relativeSource = `subtitles/${subtitle.id}.${validated.format}`;
  const source = nodePath.join(roots.control, relativeSource);
  await mkdir(nodePath.dirname(source), { recursive: true });
  if ((await realpath(nodePath.dirname(source))) !== nodePath.dirname(source))
    throw new FileGuardError("subtitle_staging_unsafe");
  try {
    await writeFile(source, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!z.object({ code: z.literal("EEXIST") }).safeParse(error).success)
      throw error;
    const existing = await lstat(source);
    if (!existing.isFile() || (await realpath(source)) !== source)
      throw new FileGuardError("subtitle_staging_unsafe");
    if (!bytes.equals(await readFile(source)))
      throw new FileGuardError("subtitle_staging_conflict");
  }
  const libraryPath = subtitleDestination({
    videoPath: location.libraryPath,
    language: subtitle.language,
    forced: subtitle.forced,
    hearingImpaired: subtitle.hearingImpaired,
    format: validated.format,
  });
  const descriptor = {
    operationId,
    downloadPath: relativeSource,
    libraryPath,
    sha256: checksum,
  };
  await files.importFile({ ...descriptor, stopAfterStaging: true });
  return { provenance, checksum, location, roots, libraryPath, descriptor };
}
