import type { z } from "zod";
import type { BundleReviewProtocolSchema } from "#shared/handoff/library-bundle.ts";
import { QualityRulesSchema, type ProfileListSchema } from "#shared/api.ts";

export type LibraryReview = z.infer<typeof BundleReviewProtocolSchema>;
export type LibraryEntry = LibraryReview["report"]["entries"][number];
type Profile = z.infer<typeof ProfileListSchema>[number];

/** Match the exact manager instance and source ancestry; numeric IDs alone never associate records. */
export function libraryBatchEntries(
  review: LibraryReview,
  keys: readonly string[],
) {
  const files = review.report.entries.filter(
    (entry) => entry.kind === "file" && keys.includes(entry.provenanceKey),
  );
  if (files.length !== keys.length || new Set(keys).size !== keys.length)
    throw new Error(
      "The selected library files changed; select the batch again",
    );
  const media = new Map(
    review.report.entries
      .filter((entry) => entry.sourceRecord.kind === "media")
      .map((entry) => [`${entry.captureHash}/${entry.sourceId}`, entry]),
  );
  const ancestors = new Map<string, LibraryEntry>();
  const managerKeys = new Set<string>();
  const covered = new Set(files.flatMap((file) => file.mediaIds));
  for (const file of files) {
    const capture = review.manifest.captures.find(
      (item) => item.captureHash === file.captureHash,
    );
    if (capture === undefined)
      throw new Error("The file's source capture is missing");
    if (capture.sourceKind !== "radarr" && capture.sourceKind !== "sonarr")
      throw new Error(
        "Library files require their movie or TV manager capture",
      );
    for (const entry of sourceAncestors(file, media)) {
      ancestors.set(entry.provenanceKey, entry);
      managerKeys.add(
        `${capture.sourceKind}/${capture.sourceInstanceId}/${entry.sourceId}`,
      );
      for (const mediaId of entry.mediaIds) covered.add(mediaId);
    }
  }
  const related = review.report.entries.filter((entry) => {
    const record = entry.sourceRecord;
    if (record.kind !== "subtitle" && record.kind !== "subtitle_preference")
      return false;
    if (
      entry.confidence !== "exact" ||
      entry.mediaIds.length === 0 ||
      !entry.mediaIds.every((id) => covered.has(id))
    )
      return false;
    const reference = record.managerReference;
    const linked =
      reference?.binding === "owner_declared" &&
      reference.sourceInstanceId !== null &&
      managerKeys.has(
        `${reference.kind}/${reference.sourceInstanceId}/${reference.sourceMediaId}`,
      );
    return (
      linked &&
      (record.kind === "subtitle_preference" ||
        files.some(
          (file) =>
            file.sourceRecord.kind === "file" &&
            file.sourceRecord.path === record.videoPath,
        ))
    );
  });
  return { entries: [...files, ...related], media: [...ancestors.values()] };
}

function sourceAncestors(
  file: LibraryEntry,
  media: ReadonlyMap<string, LibraryEntry>,
) {
  if (file.sourceRecord.kind !== "file")
    throw new Error("Expected a library file");
  const result = new Map<string, LibraryEntry>();
  for (const id of file.sourceRecord.mediaSourceIds) {
    let sourceId: string | null = id;
    const visited = new Set<string>();
    while (sourceId !== null) {
      if (visited.has(sourceId) || visited.size >= 4)
        throw new Error("The captured source hierarchy is invalid");
      visited.add(sourceId);
      const entry = media.get(`${file.captureHash}/${sourceId}`);
      if (entry?.sourceRecord.kind !== "media")
        throw new Error("The captured source hierarchy is incomplete");
      result.set(entry.provenanceKey, entry);
      sourceId = entry.sourceRecord.parentSourceId;
    }
  }
  return [...result.values()];
}

export function libraryProfileGroups(
  review: LibraryReview,
  media: readonly LibraryEntry[],
  profiles: readonly Profile[],
) {
  const groups = new Map<
    string,
    {
      key: string;
      captureId: string;
      sourceProfileId: string;
      source: string;
      options: { profile: Profile; snapshotHash: string }[];
    }
  >();
  for (const entry of media) {
    if (
      entry.sourceRecord.kind !== "media" ||
      entry.sourceRecord.profileSourceId === null
    )
      continue;
    const capture = review.manifest.captures.find(
      (item) => item.captureHash === entry.captureHash,
    );
    if (capture === undefined)
      throw new Error("The profile source capture is missing");
    const sourceProfileId = entry.sourceRecord.profileSourceId;
    const key = `${capture.captureId}/${sourceProfileId}`;
    if (groups.has(key)) continue;
    const options = [];
    for (const profile of profiles) {
      const resolved = QualityRulesSchema.parse(profile.rules).resolved;
      if (
        resolved?.source === capture.sourceKind &&
        String(resolved.profile.id) === sourceProfileId
      )
        options.push({ profile, snapshotHash: resolved.snapshotHash });
    }
    groups.set(key, {
      key,
      captureId: capture.captureId,
      sourceProfileId,
      source: capture.sourceKind,
      options,
    });
  }
  return [...groups.values()];
}

export function libraryProfileBindings(
  groups: ReturnType<typeof libraryProfileGroups>,
  choices: Readonly<Record<string, string>>,
) {
  return groups.map((group) => {
    const id =
      choices[group.key] ??
      (group.options.length === 1 ? group.options[0]?.profile.id : undefined);
    const selected = group.options.find((item) => item.profile.id === id);
    if (selected === undefined)
      throw new Error(
        `Import and select ${group.source} profile ${group.sourceProfileId} before preparing these files`,
      );
    return {
      captureId: group.captureId,
      sourceProfileId: group.sourceProfileId,
      profileId: selected.profile.id,
      version: selected.profile.version,
      snapshotHash: selected.snapshotHash,
    };
  });
}
