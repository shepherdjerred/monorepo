import { createHash } from "node:crypto";
import { z } from "zod";
import { QualityRulesSchema } from "#shared/api.ts";
import {
  GuideOverridesSchema,
  type QualityGuideKind,
} from "#shared/quality-guide/contract.ts";
import {
  VERIFIED_SOURCE_COMMITS,
  ResolvedProfileSchema,
  type SourceQuality,
} from "#domain/resolved-contract.ts";
import { SUPPORTED_SPECIFICATIONS } from "#domain/resolved-formats.ts";
import {
  GUIDE_PRESETS,
  GuideBundleSchema,
  type GuidePreset,
  type GuideBundle,
} from "./contract.ts";

function canonical(value: z.infer<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item)).join(",")}]`;
  return value !== null && typeof value === "object"
    ? `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",")}}`
    : JSON.stringify(value);
}
function unique(values: readonly string[], subject: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${subject} in selected guide`);
}
function quality(preset: GuidePreset, name: string): SourceQuality {
  const found = preset.qualities.find((entry) => entry.name === name);
  if (found === undefined)
    throw new Error(
      `Selected quality is absent from the verified source catalog: ${name}`,
    );
  return found;
}
function definitions(preset: GuidePreset, bundle: GuideBundle) {
  unique(
    bundle.sizes.qualities.map((entry) => entry.quality),
    "quality definition",
  );
  return preset.qualities.flatMap((item) => {
    const size = bundle.sizes.qualities.find(
      (entry) => entry.quality === item.name,
    );
    if (size === undefined) {
      if (preset.ladder.some((group) => group.members.includes(item.name)))
        throw new Error(`Selected quality has no guide size: ${item.name}`);
      return [];
    }
    const override = preset.sizeOverrides.find(
      (entry) => entry.name === item.name,
    );
    const maximum = override?.max ?? size.max;
    const preferred = override?.preferred ?? size.preferred;
    if (preferred < size.min || preferred > maximum || size.min > maximum)
      throw new Error(`Invalid selected quality size interval: ${item.name}`);
    return [
      {
        quality: item,
        title: item.name,
        weight: item.id,
        minSize: size.min,
        maxSize: maximum,
        preferredSize: preferred,
      },
    ];
  });
}

/** Compile only the selected immutable public guide definitions and explicit overrides. */
export function compileQualityGuide(
  kind: QualityGuideKind,
  raw: unknown,
  rawOverrides: unknown = {},
) {
  const bundle = GuideBundleSchema.parse(raw);
  const preset = GUIDE_PRESETS[kind];
  const overrides = GuideOverridesSchema.parse(rawOverrides);
  unique(
    preset.formats.map((entry) => entry.id),
    "format selection",
  );
  unique(
    bundle.formats.map((entry) => entry.trash_id),
    "format ID",
  );
  for (const id of Object.keys(overrides))
    if (!preset.formats.some((entry) => entry.id === id))
      throw new Error("Override addresses an unselected guide format");
  if (
    bundle.sizes.type !== kind ||
    (preset.profileId !== undefined &&
      bundle.profile?.trash_id !== preset.profileId)
  )
    throw new Error("Guide bundle does not match the selected profile");
  const scoreSet = bundle.profile?.trash_score_set ?? "default";
  const formats = preset.formats.map((selected, index) => {
    const source = bundle.formats.find(
      (entry) => entry.trash_id === selected.id,
    );
    if (source === undefined)
      throw new Error(`Selected guide format is missing: ${selected.id}`);
    for (const specification of source.specifications) {
      if (
        !SUPPORTED_SPECIFICATIONS.has(specification.implementation) ||
        Object.keys(specification.fields).length !== 1 ||
        (specification.implementation === "LanguageSpecification" &&
          specification.fields["value"] !== -2)
      )
        throw new Error(
          `Selected guide specification is unsupported: ${specification.implementation}`,
        );
    }
    // Some selected service formats are deliberately unscored in the guide.
    // An absent score map means zero; a present map missing its chosen/default
    // score is an invalid update, never a guessed score.
    const guideScore =
      source.trash_scores === undefined
        ? 0
        : (source.trash_scores[scoreSet] ?? source.trash_scores["default"]);
    const score = overrides[selected.id] ?? selected.score ?? guideScore;
    if (score === undefined)
      throw new Error(
        `Selected guide format has no ${scoreSet} or default score`,
      );
    return {
      trashId: selected.id,
      score,
      definition: {
        id: index + 1,
        name: source.name,
        includeCustomFormatWhenRenaming: source.includeCustomFormatWhenRenaming,
        specifications: source.specifications.map((spec) => ({
          ...spec,
          fields: Object.entries(spec.fields).map(([name, value]) => ({
            name,
            value,
          })),
        })),
      },
    };
  });
  const items = preset.ladder.map((group, index) =>
    group.members.length === 1
      ? {
          quality: quality(preset, group.members[0] ?? ""),
          allowed: true,
          items: [],
        }
      : {
          id: 1000 + index,
          name: group.name,
          allowed: true,
          items: group.members.map((name) => ({
            quality: quality(preset, name),
            allowed: true,
            items: [],
          })),
        },
  );
  const cutoffIndex = preset.ladder.findIndex(
    (group) => group.name === preset.cutoff,
  );
  const cutoffItem = items[cutoffIndex];
  if (cutoffItem === undefined)
    throw new Error("Selected guide cutoff is missing");
  const sourceCommit =
    VERIFIED_SOURCE_COMMITS[`${preset.source}:${preset.sourceVersion}`];
  if (sourceCommit === undefined)
    throw new Error("Selected guide uses an unverified source evaluator");
  const contentHash = createHash("sha256")
    .update(
      canonical(
        z.json().parse({
          kind,
          formats: bundle.formats,
          sizes: bundle.sizes,
          profile: bundle.profile ?? null,
          overrides,
          preset,
        }),
      ),
    )
    .digest("hex");
  const resolved = ResolvedProfileSchema.parse({
    schemaVersion: 1,
    source: preset.source,
    sourceVersion: preset.sourceVersion,
    sourceCommit,
    capturedAt: bundle.committedAt,
    snapshotHash: contentHash,
    properPreference: "preferAndUpgrade",
    profile: {
      id: 1,
      name: preset.name,
      upgradeAllowed: true,
      cutoff: "quality" in cutoffItem ? cutoffItem.quality.id : cutoffItem.id,
      minFormatScore: 0,
      cutoffFormatScore: 10_000,
      minUpgradeFormatScore: 1,
      language: { id: -2, name: "Original" },
      items,
      formatItems: formats.map((item) => ({
        format: item.definition.id,
        name: item.definition.name,
        score: item.score,
      })),
    },
    customFormats: formats.map((item) => item.definition),
    qualityDefinitions: definitions(preset, bundle),
    householdPolicy: {
      schemaVersion: 1,
      audio: "original",
      englishCaptionsForForeignAudio: true,
      provisionalUnknownListingAudio: true,
      rejectedFormatIds: formats
        .filter((item) => item.definition.name === "DV (w/o HDR fallback)")
        .map((item) => item.definition.id),
    },
  });
  if (resolved.householdPolicy?.rejectedFormatIds.length !== 1)
    throw new Error("Selected display compatibility guard is missing");
  return {
    name: preset.name,
    rules: QualityRulesSchema.parse({
      qualities: preset.ladder.map((group) => group.name),
      rejectedCodecs: [],
      requiredAudioLanguages: [],
      minimumBytes: 0,
      maximumBytes: Number.MAX_SAFE_INTEGER,
      minimumScore: 0,
      tagScores: {},
      cutoffQuality: preset.cutoff,
      cutoffScore: 10_000,
      resolved,
      managedGuide: {
        schemaVersion: 1,
        preset: "living-room-v1",
        kind,
        revision: bundle.revision,
        contentHash,
        scoreOverrides: overrides,
      },
    }),
  };
}
