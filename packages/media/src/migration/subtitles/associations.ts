import type { z } from "zod";
import type { BundleReportSchema } from "#shared/migration-handoff.ts";
import type { MigrationBundleProtocolSchema } from "#shared/handoff/library-bundle.ts";

type Entry = z.infer<typeof BundleReportSchema>["entries"][number];
/** Opaque source identities are explicit owner declarations, never numeric-ID inference. */
export function associateSubtitleRecords(
  entries: Entry[],
  manifest: z.infer<typeof MigrationBundleProtocolSchema>,
) {
  for (const entry of entries) {
    const record = entry.sourceRecord;
    if (record.kind !== "subtitle" && record.kind !== "subtitle_preference")
      continue;
    const reference = record.managerReference;
    if (
      reference?.sourceInstanceId == null ||
      reference.binding !== "owner_declared"
    )
      continue;
    const captures = manifest.captures.filter(
      (capture) =>
        capture.sourceKind === reference.kind &&
        capture.sourceInstanceId === reference.sourceInstanceId,
    );
    const capture = captures[0];
    if (capture === undefined || captures.length !== 1) continue;
    const media = entries.filter(
      (item) =>
        item.captureHash === capture.captureHash &&
        item.kind === "media" &&
        item.sourceId === reference.sourceMediaId &&
        item.confidence === "exact",
    );
    const match = media[0];
    if (match === undefined || media.length !== 1) continue;
    if (record.kind === "subtitle") {
      const files = entries.filter(
        (item) =>
          item.captureHash === capture.captureHash &&
          item.sourceRecord.kind === "file" &&
          item.sourceRecord.path === record.videoPath &&
          item.sourceRecord.mediaSourceIds.includes(reference.sourceMediaId),
      );
      if (record.videoPath == null || files.length !== 1) continue;
    }
    entry.mediaIds = [...match.mediaIds];
    entry.mappedMedia = [...match.mappedMedia];
    entry.confidence = "exact";
    entry.reasons = entry.reasons.filter(
      (reason) =>
        ![
          "coverage_unmapped",
          "manager_instance_binding_requires_review",
        ].includes(reason),
    );
    entry.reasons.push(
      "owner_declared_manager_binding",
      "subtitle_handoff_proof_required",
    );
    entry.state = "protected_exact";
  }
}
