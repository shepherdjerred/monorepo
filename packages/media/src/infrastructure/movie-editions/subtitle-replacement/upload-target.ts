import type { z } from "zod";
import type { currentMovieSubtitleWorkV4 } from "#automation/movie-editions/subtitles/authority.ts";
import type { MovieManualReplacementV2Schema } from "#shared/movie-editions/subtitle-replacement-v2.ts";
import { MediaError } from "#application/errors.ts";

/** Upload admission checks the current exact video and its owned installed destination. */
export function requireMovieReplacementUploadTarget(
  work: Awaited<ReturnType<typeof currentMovieSubtitleWorkV4>>,
  input: z.infer<typeof MovieManualReplacementV2Schema>,
  epoch: number,
) {
  const old = work.asset.subtitles.find(
    (row) => row.id === input.replacementFor.oldSubtitleId,
  );
  if (old === undefined || work.target === null)
    throw new MediaError(
      "replacement_target_changed",
      "Select the current exact movie caption target",
      409,
    );
  if (
    work.protectedReasons.length > 0 ||
    work.targets.length === 0 ||
    work.asset.version !== input.expectedAssetVersion ||
    work.asset.checksum !== input.expectedChecksum ||
    old.version !== input.replacementFor.expectedOldVersion ||
    old.state !== "installed" ||
    old.storageKind !== "sidecar" ||
    old.videoVersion !== work.asset.version ||
    old.videoChecksum !== work.asset.checksum ||
    old.ownershipEpoch !== epoch
  )
    throw new MediaError(
      "replacement_target_changed",
      "Select the current exact movie video and installed caption",
      409,
    );
  return { old, target: work.target };
}
