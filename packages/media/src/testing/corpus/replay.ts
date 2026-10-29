import { z } from "zod";
import { matchRelease } from "#domain/release-parser.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { evaluateResolvedRelease } from "#domain/resolved-quality.ts";
import { chooseResolvedUpgrade } from "#domain/resolved-upgrade.ts";
import { evidenceMatcher } from "#domain/resolved-evidence.ts";
import {
  prepareResolvedEvidence,
  collectResolvedEvidence,
  regexRequests,
} from "#migration/runtime-evidence.ts";
import {
  importResolvedProfiles,
  snapshotHash,
} from "#migration/profile-import.ts";
import { parseCutEvidence } from "#domain/editions/parse.ts";
import { evaluateDefaultCut } from "#domain/editions/selection.ts";
import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import {
  CorpusNativeProfileSchema,
  type CorpusInput,
  type CorpusRelease,
  type CorpusCase,
} from "./contract.ts";

export type CorpusProfile =
  | { kind: "native"; profile: QualityProfile }
  | { kind: "resolved"; profile: ResolvedProfile };
export function corpusProfile(
  entry: CorpusCase["profile"],
  raw: unknown,
): CorpusProfile {
  if (entry.kind === "native_rules") {
    const value = CorpusNativeProfileSchema.parse(raw);
    if (value.rules.resolved !== undefined)
      throw new Error(
        "Use the literal source snapshot for resolved corpus profiles",
      );
    return {
      kind: "native",
      profile: { id: value.id, version: value.version, ...value.rules },
    };
  }
  const report = importResolvedProfiles(raw).find(
    (value) => value.source === entry.source,
  );
  const profile = report?.profiles.find(
    (value) => value.profile.id === entry.profileId,
  );
  if (
    profile === undefined ||
    report === undefined ||
    report.protectedReasons.length > 0 ||
    entry.provenance.sourceVersion !== profile.sourceVersion
  )
    throw new Error(
      "Corpus source profile is missing or unsupported; no substituted profile is permitted",
    );
  return { kind: "resolved", profile };
}

export function corpusTarget(input: CorpusInput) {
  const target = input.catalog.find((item) => item.key === input.requestedKey);
  if (target === undefined || !["movie", "episode"].includes(target.kind))
    throw new Error(
      "Corpus request must identify an actual movie or episode catalog record",
    );
  const parent = input.catalog.find((item) => item.key === target.parentKey);
  const root =
    target.kind === "movie"
      ? target
      : parent?.kind === "series"
        ? parent
        : input.catalog.find((item) => item.key === parent?.parentKey);
  if (
    root === undefined ||
    (target.kind === "episode" && root.kind !== "series")
  )
    throw new Error("Corpus catalog lacks the exact series root");
  const episodes = input.catalog.filter(
    (item) =>
      item.kind === "episode" &&
      (item.parentKey === root.key ||
        input.catalog.some(
          (season) =>
            season.key === item.parentKey && season.parentKey === root.key,
        )),
  );
  return { target, root, episodes };
}

export function matchCorpusRelease(input: CorpusInput, raw: CorpusRelease) {
  const { target, root, episodes } = corpusTarget(input);
  const references = raw.references.filter(
    (item) => item.kind === (target.kind === "movie" ? "movie" : "series"),
  );
  const result = matchRelease({
    id: raw.key,
    providerId: raw.providerId,
    title: raw.title,
    sizeBytes: raw.sizeBytes,
    media: {
      id: target.key,
      kind: target.kind,
      title: target.title,
      year: target.year,
      ...(target.kind === "movie"
        ? {}
        : {
            seriesTitle: root.title,
            ...(root.year === null ? {} : { seriesYear: root.year }),
          }),
      ...(target.seasonNumber === null
        ? {}
        : { seasonNumber: target.seasonNumber }),
      ...(target.episodeNumber === null
        ? {}
        : { episodeNumber: target.episodeNumber }),
      aliases: root.aliases,
      externalIds: root.externalIds,
    },
    knownEpisodes: episodes.flatMap((item) =>
      item.seasonNumber === null || item.episodeNumber === null
        ? []
        : [
            {
              mediaId: item.key,
              season: item.seasonNumber,
              episode: item.episodeNumber,
              ...(item.absoluteNumber === null
                ? {}
                : { absoluteNumber: item.absoluteNumber }),
            },
          ],
    ),
    externalIds: Object.fromEntries(
      references.map((item) => [item.namespace, item.value]),
    ),
  });
  if (
    raw.references.some(
      (item) =>
        !references.includes(item) ||
        references.some(
          (other) =>
            other.namespace === item.namespace && other.value !== item.value,
        ),
    )
  ) {
    result.attributes.identityConfidence = "mismatch";
    result.reasons.push("external_identity_conflict");
  }
  return result;
}

export function corpusCut(
  input: CorpusInput,
  raw: CorpusRelease,
  member?: { name: string; index: number },
) {
  const { root, episodes } = corpusTarget(input);
  return parseCutEvidence({
    source:
      member === undefined
        ? {
            kind: "provider",
            providerId: raw.providerId,
            providerReleaseId: raw.key,
          }
        : {
            kind: "member",
            attemptId: raw.key,
            torrentFileIndex: member.index,
          },
    sourceDigest: snapshotHash(z.json().parse(member ?? raw)),
    canonical: {
      rootMediaId: root.key,
      title: root.title,
      aliases: root.aliases,
      digest: snapshotHash(input.catalog),
      episodeTitles: episodes.flatMap((item) =>
        item.seasonNumber === null || item.episodeNumber === null
          ? []
          : [
              {
                title: item.title,
                seasonNumber: item.seasonNumber,
                episodeNumber: item.episodeNumber,
                absoluteNumber: item.absoluteNumber,
              },
            ],
      ),
    },
    attribution: member === undefined ? "provider_texts" : "torrent_member",
    texts:
      member === undefined && raw.editionEvidence !== undefined
        ? [
            // Match releaseCut: attributed secondary fields never replace the
            // retained primary, even when the observed array is empty.
            {
              text: raw.title,
              provenance: {
                kind: "release-title",
                field: "retained.primaryTitle",
              },
            },
            ...raw.editionEvidence,
          ]
        : [
            {
              text: member?.name ?? raw.title,
              provenance: {
                kind: "release-title",
                // Preserve the existing missing-evidence corpus contract and
                // the independent literal torrent-member boundary.
                field: member === undefined ? "title" : "name",
              },
            },
          ],
  });
}

export async function prepareCorpusResolvedEvidence(
  input: CorpusInput,
  attributes: ReleaseAttributes,
  profile: ResolvedProfile,
  executable: string | undefined,
) {
  const { target } = corpusTarget(input);
  const evidence = prepareResolvedEvidence(profile, {
    id: attributes.id,
    title: attributes.title,
    identityConfirmed: attributes.identityConfidence === "exact",
    sizeBytes: attributes.sizeBytes,
    runtimeMinutes:
      attributes.mediaIds.length === 1 ? target.runtimeMinutes : null,
    originalLanguage: target.originalLanguage,
    audioLanguages:
      attributes.audioLanguages.length === 0
        ? null
        : [...attributes.audioLanguages],
    specialEpisode: target.seasonNumber === 0,
  });
  if (
    evidence.protectedReasons.length > 0 ||
    regexRequests(profile, evidence.release).length === 0
  )
    return evidence;
  if (executable === undefined)
    throw new Error(
      "Corpus needs the actual packaged regex executable; no simulated regex decisions are permitted",
    );
  return collectResolvedEvidence(profile, evidence, executable);
}

async function evaluateCorpusResolved(context: {
  input: CorpusInput;
  attributes: ReleaseAttributes;
  current: ReleaseAttributes | null;
  profile: ResolvedProfile;
  executable: string | undefined;
}) {
  const { input, attributes, current, profile, executable } = context;
  const evidence = await prepareCorpusResolvedEvidence(
    input,
    attributes,
    profile,
    executable,
  );
  const old =
    current === null
      ? null
      : await prepareCorpusResolvedEvidence(
          input,
          current,
          profile,
          executable,
        );
  const matcher = evidenceMatcher(old === null ? [evidence] : [evidence, old]);
  const checked = evaluateResolvedRelease(profile, evidence.release, matcher);
  const upgrade = chooseResolvedUpgrade({
    profile,
    candidate: evidence.release,
    current: old?.release ?? null,
    matcher,
  });
  const reasons = [
    ...evidence.protectedReasons,
    ...checked.reasons,
    ...(attributes.mediaIds.includes(input.requestedKey)
      ? []
      : ["incomplete_coverage"]),
    ...(old !== null && old.protectedReasons.length > 0
      ? ["current_evidence_unknown"]
      : []),
  ];
  return {
    accepted: checked.status === "accepted" && reasons.length === 0,
    reasons,
    qualityRank: checked.qualityRank,
    score: checked.score,
    upgrade: upgrade.upgrade && reasons.length === 0,
    upgradeReason: upgrade.reason,
  };
}

/** Inputs never contain expected labels, resolved evidence or authoritative coverage. */
export async function replayCorpusCandidate(
  input: CorpusInput,
  raw: CorpusRelease,
  policy: CorpusProfile,
  executable?: string,
) {
  const candidate = matchCorpusRelease(input, raw);
  const current =
    input.current === null ? null : matchCorpusRelease(input, input.current);
  const cut = corpusCut(input, raw);
  const edition = evaluateDefaultCut({
    candidate: cut,
    current: input.current === null ? [] : [corpusCut(input, input.current)],
  });
  let evaluation;
  if (policy.kind === "native") {
    const decision = chooseUpgrade({
      candidate: candidate.attributes,
      current: current?.attributes ?? null,
      profile: policy.profile,
      mediaIds: [input.requestedKey],
    });
    evaluation = {
      ...decision.evaluation,
      upgrade: decision.upgrade,
      upgradeReason: decision.reason,
    };
  } else {
    evaluation = await evaluateCorpusResolved({
      input,
      attributes: candidate.attributes,
      current: current?.attributes ?? null,
      profile: policy.profile,
      executable,
    });
  }
  return {
    key: raw.key,
    attributes: candidate.attributes,
    edition: cut.conclusion.kind,
    accepted: evaluation.accepted && evaluation.upgrade && edition.accepted,
    reasons: [
      ...candidate.reasons,
      ...evaluation.reasons,
      ...edition.reasons,
      ...(evaluation.upgrade ? [] : [evaluation.upgradeReason]),
    ],
    qualityRank: evaluation.qualityRank,
    score: evaluation.score,
  };
}
export type CorpusCandidateResult = Awaited<
  ReturnType<typeof replayCorpusCandidate>
>;
