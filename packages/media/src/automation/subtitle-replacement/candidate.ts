import { createHash } from "node:crypto";
import { z } from "zod";
import type { SubtitleAsset } from "#generated/prisma/client.ts";
import { validateSubtitle } from "#integrations/subtitle-validation.ts";
import { FileGuardError } from "#automation/files/types.ts";

export function replacementCandidateBytes(subtitle: SubtitleAsset) {
  if (subtitle.content === null)
    throw new FileGuardError("subtitle_content_missing");
  const provenance = z
    .object({
      filename: z.string(),
      description: z.string(),
      format: z.enum(["srt", "ass", "ssa", "vtt"]),
    })
    .parse(subtitle.provenance);
  const validated = validateSubtitle({
    bytes: subtitle.content,
    filename: provenance.filename,
    provenanceText: provenance.description,
    requireSimplified: ["zh-CN", "zh-Hans"].includes(subtitle.language),
  });
  const bytes = Buffer.from(validated.text);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (validated.format !== provenance.format || checksum !== subtitle.checksum)
    throw new FileGuardError("subtitle_candidate_content_changed");
  return { bytes, checksum, format: provenance.format };
}
