import type { GitHubReleaseNote } from "@shepherdjerred/ops-clients/github.ts";
import type { DependencyDashboard } from "@shepherdjerred/ops-clients/renovate.ts";
import type { RenovateVersionDelta } from "@shepherdjerred/ops-model/facets.ts";
import {
  compareRankedRenovateUpdates,
  type RankedRenovateUpdate,
  type RenovateTarget,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";

import {
  isVersionInDeltaWindow,
  normalizeVersionString,
} from "#activities/ops/renovate-delta/semver-utils.ts";
import type { AdvisoryImpact } from "./ranking-advisories.ts";
import {
  candidateId,
  publicEvidenceUrl,
  targetKey,
  type LookupTarget,
} from "./ranking-report.ts";

export type ReleaseEvidence = {
  readonly breaking: boolean;
  readonly urls: string[];
  readonly complete: boolean;
};

type AssessmentEvidence = {
  readonly dashboard?: DependencyDashboard | undefined;
  readonly advisories: ReadonlyMap<LookupTarget, AdvisoryImpact>;
  readonly releases: ReadonlyMap<LookupTarget, ReleaseEvidence>;
  readonly deltas: Readonly<Record<string, RenovateVersionDelta>>;
};

export function githubReleaseSource(
  entry: LookupTarget,
): { owner: string; name: string } | null {
  for (const href of entry.evidenceUrls) {
    const url = new URL(href);
    const [, owner, name] = url.pathname.split("/");
    if (
      owner !== undefined &&
      name !== undefined &&
      url.hostname === "github.com" &&
      /^[\w.-]+$/u.test(owner) &&
      /^[\w.-]+$/u.test(name)
    ) {
      return { owner, name: name.replace(/\.git$/u, "") };
    }
  }
  return null;
}

export function extractReleaseEvidence(
  entry: LookupTarget,
  releases: readonly GitHubReleaseNote[],
  complete: boolean,
): ReleaseEvidence {
  const version = entry.target.targetVersion;
  if (version === null) return { breaking: false, urls: [], complete };
  const matching = releases.filter(
    (release) =>
      !release.prerelease &&
      isVersionInDeltaWindow({
        candidateTag: release.tagName,
        effectiveFromVersion: entry.target.currentVersion,
        targetVersion: version,
      }),
  );
  return {
    complete,
    breaking: matching.some((release) =>
      /^\s*(?:#+\s*|[-*]\s*)?breaking\b|\bbreaking\s+changes?\b/imu.test(
        release.body,
      ),
    ),
    urls: matching.slice(0, 4).flatMap((release) => {
      const url = publicEvidenceUrl(release.url);
      return url === undefined ? [] : [url];
    }),
  };
}

function platformProof(entry: LookupTarget): string | null {
  const { lookupName, target } = entry;
  if (
    [
      "siderolabs/talos",
      "siderolabs/kubelet",
      "siderolabs/installer-liskov",
      "siderolabs/installer-torvalds",
      "ghcr.io/siderolabs/installer",
      "kubernetes/kubernetes",
    ].includes(lookupName)
  ) {
    return "Talos and Kubernetes require the coordinated live cluster upgrade procedure.";
  }
  if (
    lookupName.startsWith("shepherdjerred/") &&
    lookupName.endsWith("/prod")
  ) {
    return "First-party production promotion requires the owning release procedure.";
  }
  if (lookupName === "gpui-kit" || lookupName.startsWith("gpui-pre")) {
    return "Scout Desktop GPUI needs a separate PR and the required Windows interaction check.";
  }
  if (
    lookupName === "Microsoft.WindowsAppSDK" ||
    lookupName === "Microsoft.Windows.SDK.BuildTools"
  ) {
    return "The Windows App SDK requires a native Windows build and packaging check.";
  }
  return target.filePath.startsWith(".github/workflows/")
    ? "GitHub workflow changes require a publisher with workflow permissions."
    : null;
}

function combinedBake(
  entries: readonly LookupTarget[],
): RankedRenovateUpdate["bake"] {
  const unknown = entries.find((entry) => entry.bake.state === "unknown");
  if (unknown !== undefined) return unknown.bake;
  const latest =
    entries
      .flatMap(({ bake }) =>
        bake.eligibleAt === null ? [] : [bake.eligibleAt],
      )
      .sort()
      .at(-1) ?? null;
  return entries.some((entry) => entry.bake.state === "waiting")
    ? {
        state: "waiting",
        eligibleAt: latest,
        reason: "At least one member is still within its release-age wait.",
      }
    : {
        state: "ready",
        eligibleAt: latest,
        reason: "All members passed the applicable release-age rules.",
      };
}

function sameTargetDelta(
  entries: readonly LookupTarget[],
  delta: RenovateVersionDelta | undefined,
): RenovateVersionDelta | undefined {
  if (delta === undefined) return undefined;
  const deltaVersion = normalizeVersionString(delta.targetVersion);
  const deltaBaseline = normalizeVersionString(delta.effectiveFromVersion);
  const matches =
    deltaVersion !== null &&
    deltaBaseline !== null &&
    entries.every(
      ({ target }) =>
        normalizeVersionString(target.targetVersion) === deltaVersion &&
        normalizeVersionString(target.currentVersion) === deltaBaseline,
    );
  return matches ? delta : undefined;
}

function estimateEffort(input: {
  paths: number;
  packages: number;
  breaking: boolean;
  releaseNotesBreaking: boolean;
  releaseNotesPartial: boolean;
  blockers: readonly string[];
}): RankedRenovateUpdate["effort"] {
  if (input.blockers.length > 0) return "unknown";
  const missingBreakingEvidence =
    input.releaseNotesBreaking || input.releaseNotesPartial;
  if (missingBreakingEvidence || input.breaking) {
    if (missingBreakingEvidence && input.paths > 20) return "xl";
    return input.paths > 6 || input.packages > 3 ? "l" : "m";
  }
  if (input.paths > 8 || input.packages > 4) return "m";
  return input.paths > 1 ? "s" : "xs";
}

function groupTargetsConflict(targets: readonly RenovateTarget[]): boolean {
  const slots = new Map<string, string>();
  for (const target of targets) {
    const slot = JSON.stringify([
      target.filePath,
      target.packageName,
      target.currentValue,
      target.currentDigest,
    ]);
    const desired = JSON.stringify([
      target.targetValue,
      target.targetVersion,
      target.digest,
    ]);
    const previous = slots.get(slot);
    if (previous !== undefined && previous !== desired) return true;
    slots.set(slot, desired);
  }
  return false;
}

function advisoryBlocker(impact: AdvisoryImpact | undefined): string | null {
  switch (impact?.state) {
    case "missing-version":
      return "Advisory assessment needs exact installed and target versions.";
    case "unavailable":
      return "Advisory lookup did not complete for this target.";
    case "assessed":
    case undefined:
      return null;
  }
}

function changeSummary(input: {
  readonly breaking: boolean;
  readonly releaseNotesBreaking: boolean;
  readonly releaseNotesPartial: boolean;
}): string {
  if (input.releaseNotesBreaking)
    return "Upstream release notes identify breaking changes.";
  if (input.breaking) return "The version jump may require source migration.";
  return input.releaseNotesPartial
    ? ""
    : "Routine maintenance for a declared dependency.";
}

function classifyGroup(input: {
  branch: string;
  entries: LookupTarget[];
  evidence: AssessmentEvidence;
  dashboardRow: DependencyDashboard["updates"][number] | undefined;
}): RankedRenovateUpdate {
  const { branch, entries, evidence, dashboardRow } = input;
  const uniqueTargets = new Map(
    entries.map(({ target }) => [targetKey(target), target]),
  );
  const targets = [...uniqueTargets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, target]) => target);
  const packages = [
    ...new Set(targets.map((target) => target.packageName)),
  ].sort();
  const paths = new Set(targets.map((target) => target.filePath));
  const untouched = dashboardRow?.state === "ignored";
  const fixed = new Set(
    entries.flatMap((entry) => evidence.advisories.get(entry)?.fixed ?? []),
  );
  const added = new Set(
    entries.flatMap((entry) => evidence.advisories.get(entry)?.added ?? []),
  );
  const delta = sameTargetDelta(entries, evidence.deltas[branch]);
  const releaseNotes = entries.flatMap((entry) => {
    const impact = evidence.releases.get(entry);
    return impact === undefined ? [] : [impact];
  });
  const blockers = [
    ...new Set([
      ...entries.flatMap((entry) => {
        const proof = platformProof(entry);
        return [
          entry.blocker,
          proof,
          advisoryBlocker(evidence.advisories.get(entry)),
        ].filter((message) => message !== null);
      }),
      ...(untouched
        ? ["The Dependency Dashboard marks this proposal ignored."]
        : []),
      ...(groupTargetsConflict(targets)
        ? [
            "Renovate returned conflicting exact targets for a declaration in this group.",
          ]
        : []),
      ...(added.size === 0
        ? []
        : [
            `The target introduces an advisory absent from the installed version (${[...added].slice(0, 4).join(", ")}).`,
          ]),
    ]),
  ];
  const breaking = entries.some(
    (entry) => entry.breaking || entry.updateType === "major",
  );
  const releaseNotesBreaking =
    Boolean(delta?.breakingChanges.length) ||
    releaseNotes.some((release) => release.breaking);
  const releaseNotesPartial = releaseNotes.some((release) => !release.complete);
  const effort = estimateEffort({
    paths: paths.size,
    packages: packages.length,
    breaking,
    releaseNotesBreaking,
    releaseNotesPartial,
    blockers,
  });
  const devOnly = entries.every((entry) => entry.devOnly);
  const urgency: RankedRenovateUpdate["urgency"] =
    fixed.size > 0 ? "high" : devOnly ? "low" : "medium";
  const rationale = [
    fixed.size === 0
      ? ""
      : `Fixes known advisories ${[...fixed].slice(0, 4).join(", ")}.`,
    delta?.summary ??
      changeSummary({ breaking, releaseNotesBreaking, releaseNotesPartial }),
    releaseNotesPartial ? "Upstream release-note coverage is incomplete." : "",
    `Renovate found ${String(paths.size)} affected declaration ${paths.size === 1 ? "file" : "files"}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const ecosystems = new Set(
    targets.map((target) => target.datasource ?? target.manager),
  );
  return {
    id: candidateId(branch, targets),
    name: packages.join(", "),
    ecosystem:
      ecosystems.size === 1
        ? (ecosystems.values().next().value ?? "unknown")
        : "mixed",
    targets,
    urgency,
    effort,
    needed: !untouched,
    rationale,
    evidenceUrls: [
      ...new Set([
        ...[...fixed, ...added].map(
          (id) => `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
        ),
        ...[...(delta?.releaseUrls ?? []), delta?.compareUrl].flatMap(
          (href) => {
            const url = publicEvidenceUrl(href);
            return url === undefined ? [] : [url];
          },
        ),
        ...releaseNotes.flatMap((release) => release.urls),
        ...entries.flatMap((entry) => entry.evidenceUrls),
      ]),
    ].slice(0, 12),
    bake: combinedBake(entries),
    blockers,
  };
}

export function rankLookupTargets(
  targets: readonly LookupTarget[],
  evidence: AssessmentEvidence,
): RankedRenovateUpdate[] {
  const groups = new Map<string, LookupTarget[]>();
  const dashboard = new Map(
    evidence.dashboard?.updates.map((row) => [row.branch, row]),
  );
  for (const target of targets) {
    const group = groups.get(target.branch) ?? [];
    group.push(target);
    groups.set(target.branch, group);
  }
  return [...groups]
    .map(([branch, entries]) =>
      classifyGroup({
        branch,
        entries: entries.sort((left, right) =>
          targetKey(left.target).localeCompare(targetKey(right.target)),
        ),
        evidence,
        dashboardRow: dashboard.get(branch),
      }),
    )
    .sort(compareRankedRenovateUpdates);
}
