import { z } from "zod";
import { canonicalOrder } from "./canonical-order.ts";
import { createHash } from "node:crypto";
import {
  ResolvedProfileSchema,
  SourceInventorySchema,
  VERIFIED_SOURCE_COMMITS,
} from "#domain/resolved-contract.ts";
import type {
  ResolvedProfile,
  SourceInventory,
} from "#domain/resolved-contract.ts";
import { SUPPORTED_SPECIFICATIONS } from "#domain/resolved-formats.ts";

export const ProfileSnapshotSchema = z.object({
  capturedAt: z.iso.datetime(),
  inventories: z.array(SourceInventorySchema),
});
type Json = z.infer<ReturnType<typeof z.json>>;
function canonical(value: Json): Json {
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  return typeof value !== "object" || value === null
    ? value
    : Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => canonicalOrder(left, right))
          .map(([key, item]) => [key, canonical(item)]),
      );
}
export function snapshotHash(value: Json): string {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function unique(values: number[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${label} in source snapshot`);
}
function validateInventory(inventory: SourceInventory): void {
  unique(
    inventory.profiles.map((profile) => profile.id),
    "profile ID",
  );
  unique(
    inventory.customFormats.map((format) => format.id),
    "format ID",
  );
  unique(
    inventory.qualityDefinitions.map((definition) => definition.quality.id),
    "quality definition",
  );
  for (const profile of inventory.profiles) {
    const qualityIds = profile.items.flatMap((item) =>
      "quality" in item
        ? [item.quality.id]
        : item.items.map((leaf) => leaf.quality.id),
    );
    const groupIds = profile.items.flatMap((item) =>
      "quality" in item ? [] : [item.id],
    );
    unique([...qualityIds, ...groupIds], "quality/group ID");
    unique(
      profile.formatItems.map((item) => item.format),
      "profile format",
    );
    if (![...qualityIds, ...groupIds].includes(profile.cutoff))
      throw new Error("Profile cutoff is missing from quality groups");
    if (!profile.items.some((item) => item.allowed))
      throw new Error("Profile has no allowed quality");
    for (const item of profile.formatItems) {
      if (!inventory.customFormats.some((format) => format.id === item.format))
        throw new Error("Profile references a missing custom format");
    }
  }
}
export type ProfileImportReport = {
  source: string;
  sourceVersion: string;
  snapshotHash: string;
  profiles: ResolvedProfile[];
  protectedReasons: string[];
  requiredEvidence: string[];
  mayWrite: false;
};
/** Pure read-only conversion: output never changes source settings or adopts files. */
export function importResolvedProfiles(value: unknown): ProfileImportReport[] {
  const snapshot = ProfileSnapshotSchema.parse(value);
  return snapshot.inventories.map((inventory) => {
    validateInventory(inventory);
    const hash = snapshotHash(z.json().parse(inventory));
    const commit =
      VERIFIED_SOURCE_COMMITS[`${inventory.source}:${inventory.version}`];
    const unsupported = [
      ...new Set(
        inventory.customFormats.flatMap((format) =>
          format.specifications
            .filter(
              (spec) => !SUPPORTED_SPECIFICATIONS.has(spec.implementation),
            )
            .map((spec) => spec.implementation),
        ),
      ),
    ];
    const protectedReasons = unsupported.map(
      (name) => `unsupported_specification:${name}`,
    );
    if (commit === undefined)
      protectedReasons.push("source_version_not_verified");
    const profiles =
      commit === undefined
        ? []
        : inventory.profiles.map((profile) =>
            ResolvedProfileSchema.parse({
              schemaVersion: 1,
              source: inventory.source,
              sourceVersion: inventory.version,
              sourceCommit: commit,
              capturedAt: snapshot.capturedAt,
              snapshotHash: hash,
              properPreference: inventory.properPreference,
              profile,
              customFormats: inventory.customFormats,
              qualityDefinitions: inventory.qualityDefinitions,
            }),
          );
    return {
      source: inventory.source,
      sourceVersion: inventory.version,
      snapshotHash: hash,
      profiles,
      protectedReasons,
      requiredEvidence: [
        "source_normalized_quality_and_title",
        "bounded_dotnet_ignorecase_regex",
        "runtime_minutes",
        "original_audio_language",
      ],
      mayWrite: false,
    };
  });
}

/** Desired configuration stays a separate observation; it never replaces the observed snapshot. */
export function reportProfileDrift(
  report: ProfileImportReport,
  desired: { profileNames: string[] },
): {
  desiredMissing: string[];
  observedUnscored: string[];
} {
  return {
    desiredMissing: desired.profileNames.filter(
      (name) => !report.profiles.some((item) => item.profile.name === name),
    ),
    observedUnscored: report.profiles
      .filter((item) =>
        item.profile.formatItems.every((format) => format.score === 0),
      )
      .map((item) => item.profile.name),
  };
}
