import { NativeRecoveryInventorySchema } from "#shared/native-recovery.ts";
import {
  PrepareLibraryHandoffV3Schema,
  LibrarySubtitlePolicyVersionsSchema,
} from "#shared/handoff/library-v3.ts";
import type { MovieEditionKey } from "#shared/movie-editions/registry.ts";
import { readApi } from "#client/api.ts";
import {
  libraryBatchEntries,
  libraryProfileBindings,
  type LibraryReview,
  type libraryProfileGroups,
} from "./selection.ts";

export type CutChoice = {
  edition: MovieEditionKey | "suggest";
  reason: string;
};
export type BatchChoices = {
  files: string[];
  cuts: Record<string, CutChoice>;
  profiles: Record<string, string>;
  chinese: Record<string, boolean>;
};

/** Fetch actual policy versions; neither a missing read nor mixed versions becomes a made-up default. */
export async function prepareLibraryBatch(
  review: LibraryReview,
  choices: BatchChoices,
  groups: ReturnType<typeof libraryProfileGroups>,
) {
  const batch = libraryBatchEntries(review, choices.files);
  const policies = batch.entries.filter(
    (entry) => entry.kind === "subtitle_preference",
  );
  const ids = [...new Set(policies.flatMap((entry) => entry.mediaIds))];
  if (ids.length > 100)
    throw new Error("Select a smaller batch with at most 100 policy targets");
  const [inventory, versions] = await Promise.all([
    readApi("/admin/native-recovery", NativeRecoveryInventorySchema),
    ids.length === 0
      ? []
      : readApi(
          `/admin/handoffs/subtitle-policies?${new URLSearchParams(ids.map((id) => ["mediaId", id])).toString()}`,
          LibrarySubtitlePolicyVersionsSchema,
        ),
  ]);
  const runtime = inventory.runtime;
  if (runtime.mode !== "observe" && runtime.mode !== "active")
    throw new Error("Library import requires a ready runtime");
  const byId = new Map(versions.map((item) => [item.mediaId, item.version]));
  return PrepareLibraryHandoffV3Schema.parse({
    schemaVersion: 3,
    purpose: "migration",
    plexEditionLabels: "update_in_place",
    bundleReviewId: review.id,
    bundleReviewVersion: review.version,
    bundleHash: review.manifest.bundleHash,
    reportHash: review.report.reportHash,
    recoveryEpoch: runtime.recoveryEpoch,
    runtimeVersion: runtime.version,
    activation: runtime.mode === "observe" ? "activate" : "extend",
    selected: batch.entries.map((entry) => ({
      provenanceKey: entry.provenanceKey,
      evidenceHash: entry.observationHash,
    })),
    profiles: libraryProfileBindings(groups, choices.profiles),
    movies: Object.entries(choices.cuts).flatMap(([provenanceKey, choice]) =>
      choice.edition !== "suggest" && choices.files.includes(provenanceKey)
        ? [
            {
              provenanceKey,
              edition: choice.edition,
              resolution: { kind: "owner_review", reason: choice.reason },
            },
          ]
        : [],
    ),
    subtitlePolicies: policies.map((entry) => {
      const current = new Set(entry.mediaIds.map((id) => byId.get(id)));
      const version = [...current][0];
      if (version === undefined || current.size !== 1)
        throw new Error(
          "Subtitle policy versions differ; prepare these files in separate batches",
        );
      return {
        provenanceKey: entry.provenanceKey,
        expectedPolicyVersion: version,
        chinese:
          choices.chinese[entry.provenanceKey] === true
            ? "require_simplified"
            : "unresolved",
      };
    }),
  });
}
