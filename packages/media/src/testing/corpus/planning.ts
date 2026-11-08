import path from "node:path";
import { z } from "zod";
import { fileCoverage, probeAttributes } from "#automation/files/inspection.ts";
import {
  newLibraryPath,
  type NamingItem,
} from "#automation/files/library-path.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { inspectMedia, MediaToolError } from "#filesystem/media-tools.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { evaluateResolvedRelease } from "#domain/resolved-quality.ts";
import { chooseResolvedUpgrade } from "#domain/resolved-upgrade.ts";
import { evidenceMatcher } from "#domain/resolved-evidence.ts";
import {
  prepareResolvedEvidence,
  collectResolvedEvidence,
  regexRequests,
} from "#migration/runtime-evidence.ts";
import { measureQuality } from "#automation/files/resolved-measurement.ts";
import { evaluateDefaultCut } from "#domain/editions/selection.ts";
import type { ReleaseAttributes } from "#shared/contract.ts";
import type { ResolvedProfile } from "#domain/resolved-contract.ts";
import type { CorpusInput, CorpusRelease, CorpusPlan } from "./contract.ts";
import {
  corpusCut,
  matchCorpusRelease,
  prepareCorpusResolvedEvidence,
  type CorpusProfile,
  type CorpusCandidateResult,
} from "./replay.ts";

type PlanResult = {
  status: "not_provided" | "protected" | "planned";
  reasons: string[];
  entries: CorpusPlan[];
};
type PlanContext = {
  input: CorpusInput;
  policy: CorpusProfile;
  executable?: string | undefined;
};
type PlanInput = PlanContext & {
  raw: CorpusRelease;
  candidate: CorpusCandidateResult;
};

/** Planning only: raw ffprobe bytes replace the external process, while its real parser and quality checks run. */
export async function replayCorpusPlan(
  context: PlanInput,
): Promise<PlanResult> {
  const { raw, candidate } = context;
  if (raw.members === null)
    return { status: "not_provided", reasons: [], entries: [] };
  if (!candidate.accepted)
    return { status: "protected", reasons: candidate.reasons, entries: [] };
  try {
    const entries = await planMembers(context);
    return { status: "planned", reasons: [], entries };
  } catch (error) {
    if (error instanceof FileGuardError)
      return { status: "protected", reasons: [error.reason], entries: [] };
    if (error instanceof MediaToolError || error instanceof z.ZodError)
      return {
        status: "protected",
        reasons: ["probe_boundary_invalid"],
        entries: [],
      };
    throw error;
  }
}

function namingItems(input: CorpusInput, ids: readonly string[]): NamingItem[] {
  return ids.map((id) => {
    const media = input.catalog.find((value) => value.key === id);
    if (media === undefined)
      throw new Error("Derived coverage is absent from catalog");
    const parent = input.catalog.find((value) => value.key === media.parentKey);
    const ancestor = input.catalog.find(
      (value) => value.key === parent?.parentKey,
    );
    return {
      ...media,
      id,
      parent:
        parent === undefined ? null : { ...parent, parent: ancestor ?? null },
    };
  });
}

async function planMembers(context: PlanInput) {
  const { input, raw, candidate } = context;
  const members = (raw.members ?? []).filter(
    (member) =>
      /\.(?:mkv|mp4|m4v|avi)$/iu.test(member.name) &&
      !/(?:^|[/._ -])(?:sample|extras|featurettes|trailer)(?:[/._ -]|$)/iu.test(
        member.name,
      ),
  );
  const media = namingItems(input, candidate.attributes.mediaIds);
  if (members.length === 0) throw new FileGuardError("video_missing");
  if (members.length > 100) throw new FileGuardError("plan_entry_bound");
  if (members.length !== 1 && media.some((item) => item.kind === "movie"))
    throw new FileGuardError("movie_files_ambiguous");
  const edition = evaluateDefaultCut({
    candidate: corpusCut(input, raw),
    current: input.current === null ? [] : [corpusCut(input, input.current)],
    members: members.map((member, index) =>
      corpusCut(input, raw, { name: member.name, index }),
    ),
  });
  if (!edition.accepted) throw new FileGuardError(edition.reasons.join(","));
  const entries: CorpusPlan[] = [];
  for (const member of members) {
    entries.push(await planMember(context, member, media));
  }
  const coverage = entries.flatMap((entry) => entry.coverage);
  if (
    new Set(coverage).size !== coverage.length ||
    candidate.attributes.mediaIds.some((id) => !coverage.includes(id))
  )
    throw new FileGuardError("file_coverage_incomplete");
  if (
    new Set(entries.map((entry) => entry.libraryPath)).size !== entries.length
  )
    throw new FileGuardError("library_path_collision");
  return entries;
}

async function planMember(
  context: PlanInput,
  member: NonNullable<CorpusRelease["members"]>[number],
  media: NamingItem[],
): Promise<CorpusPlan> {
  const { candidate } = context;
  if (
    path.isAbsolute(member.name) ||
    member.name
      .split(/[\\/]/u)
      .some((part) => part === ".." || part === "." || part === "")
  )
    throw new FileGuardError("download_path_unsafe");
  const coverage = fileCoverage(member.name, media);
  if (coverage.length === 0 || member.progress !== 1)
    throw new FileGuardError("file_coverage_unconfirmed");
  const bytes = new TextEncoder().encode(JSON.stringify(member.probe));
  if (bytes.byteLength > 2 * 1024 * 1024)
    throw new FileGuardError("probe_boundary_too_large");
  const probe = await inspectMedia(member.name, {
    run: () => Promise.resolve(bytes),
  });
  if (Number(probe.format.size) !== member.sizeBytes)
    throw new FileGuardError("file_size_changed");
  const measured = {
    ...candidate.attributes,
    ...probeAttributes(probe, candidate.attributes.quality),
    mediaIds: coverage,
    sizeBytes: member.sizeBytes,
  };
  await assertMeasuredPolicy(context, measured, member.name);
  return {
    sourceName: member.name,
    coverage: coverage.toSorted(),
    libraryPath: newLibraryPath(
      media.filter((item) => coverage.includes(item.id)),
      member.name,
    ),
  };
}

async function assertMeasuredPolicy(
  context: PlanContext,
  measured: ReleaseAttributes,
  filename: string,
) {
  const { input, policy, executable } = context;
  if (policy.kind === "native") {
    assertNativeMeasuredPolicy(input, measured, policy.profile);
    return;
  }
  const covered = input.catalog.filter((item) =>
    measured.mediaIds.includes(item.key),
  );
  const current =
    input.current === null
      ? null
      : await prepareCorpusResolvedEvidence(
          input,
          matchCorpusRelease(input, input.current).attributes,
          policy.profile,
          executable,
        );
  for (const media of covered) {
    const evidence = await prepareMeasuredEvidence({
      profile: policy.profile,
      measured,
      filename,
      covered,
      media,
      executable,
    });
    const matcher = evidenceMatcher(
      current === null ? [evidence] : [evidence, current],
    );
    const evaluated = evaluateResolvedRelease(
      policy.profile,
      evidence.release,
      matcher,
    );
    const upgrade = chooseResolvedUpgrade({
      profile: policy.profile,
      candidate: evidence.release,
      current: current?.release ?? null,
      matcher,
    });
    if (
      evidence.protectedReasons.length > 0 ||
      evaluated.status !== "accepted" ||
      !upgrade.upgrade ||
      (current !== null && current.protectedReasons.length > 0)
    )
      throw new FileGuardError("measured_quality_rejected");
  }
}

function assertNativeMeasuredPolicy(
  input: CorpusInput,
  measured: ReleaseAttributes,
  profile: Extract<CorpusProfile, { kind: "native" }>["profile"],
) {
  const current =
    input.current === null
      ? null
      : matchCorpusRelease(input, input.current).attributes;
  for (const mediaId of measured.mediaIds) {
    const decision = chooseUpgrade({
      candidate: measured,
      current,
      profile,
      mediaIds: [mediaId],
    });
    if (!decision.upgrade)
      throw new FileGuardError(`measured_quality_rejected:${decision.reason}`);
  }
}

async function prepareMeasuredEvidence(context: {
  profile: ResolvedProfile;
  measured: ReleaseAttributes;
  filename: string;
  covered: CorpusInput["catalog"];
  media: CorpusInput["catalog"][number];
  executable: string | undefined;
}) {
  const { profile, measured, filename, covered, media, executable } = context;
  const prepared = prepareResolvedEvidence(profile, {
    id: measured.id,
    title: measured.title,
    filename: path.basename(filename),
    identityConfirmed: measured.identityConfidence === "exact",
    sizeBytes: measured.sizeBytes,
    runtimeMinutes: covered.every((item) => item.runtimeMinutes !== null)
      ? covered.reduce((sum, item) => sum + (item.runtimeMinutes ?? 0), 0)
      : null,
    originalLanguage: media.originalLanguage,
    audioLanguages:
      measured.audioLanguages.length === 0
        ? null
        : [...measured.audioLanguages],
    specialEpisode: covered.every((item) => item.seasonNumber === 0),
  });
  measureQuality(profile, prepared, measured.quality);
  if (
    executable === undefined &&
    regexRequests(profile, prepared.release).length > 0
  )
    throw new Error(
      "Measured corpus evidence requires the actual packaged regex executable",
    );
  return regexRequests(profile, prepared.release).length === 0
    ? prepared
    : await collectResolvedEvidence(profile, prepared, executable);
}
