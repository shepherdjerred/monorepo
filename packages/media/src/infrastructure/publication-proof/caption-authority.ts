import type { PublicationAssetSnapshot } from "#shared/publication-proof/intent.ts";
import type { PublicationSubtitleLineage } from "#shared/publication-proof/subtitle-lineage.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

/** Parent validation uses only immutable baseline, recorded predecessor and its bound supplement. */
export function assertRecordedCaptionLineage(
  lineage: PublicationSubtitleLineage,
  baseline: PublicationAssetSnapshot["subtitles"],
  current: PublicationAssetSnapshot["subtitles"],
) {
  if (
    lineage.baselineHash !== snapshotHash(nativeJson(baseline)) ||
    lineage.currentHash !== snapshotHash(nativeJson(current))
  )
    throw new Error("Publication original caption lineage changed");
  const replaced = new Map(
    lineage.replacements.map((item) => [item.beforeId, item.afterId]),
  );
  const expected = [
    ...baseline.map((item) => replaced.get(item.id) ?? item.id),
    ...lineage.installations.map((item) => item.subtitleId),
  ];
  if (
    replaced.size !== lineage.replacements.length ||
    lineage.replacements.some(
      (item) =>
        !baseline.some(
          (subtitle) =>
            subtitle.id === item.beforeId && subtitle.storageKind === "sidecar",
        ),
    ) ||
    new Set(expected).size !== expected.length ||
    snapshotHash(expected.sort()) !==
      snapshotHash(current.map((item) => item.id).sort())
  )
    throw new Error("Publication original caption lineage coverage changed");
}
