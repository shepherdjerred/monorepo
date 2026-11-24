import {
  runCodexPrRemediationWithExtra,
  type CodexPrRemediationDependencies,
  type CodexPrVerificationResult,
} from "#activities/remediation/codex-pr-remediation.ts";
import { revertSingleRepoPath } from "#activities/remediation/codex-pr-remediation-git.ts";
import {
  verifyUrlHttp200,
  type HttpUrlCheckFn,
} from "#activities/remediation/http-url-check.ts";
import {
  CatalogSchema,
  FullCatalogSchema,
  VERSION_CATALOG_PATH,
  type FullCatalog,
  type ReleaseNotesOverride,
  type StrictCatalogEntry,
} from "#activities/remediation/version-catalog-schema.ts";
import {
  runCommand as defaultRunCommand,
  type GitCommandRunner,
} from "#activities/scout/scout-season-refresh-git.ts";
import type {
  DependencyChange,
  ReleaseNote,
} from "#shared/deps-summary-types.ts";
import type { ReportRemediationV1 } from "@shepherdjerred/ops-model/reports/report-envelope.ts";
import type { MissingReleaseNote } from "./deps-summary-release-notes.ts";

export type ProposeReleaseNoteOverridesResult = {
  remediation: ReportRemediationV1;
  resolvedNotes: ReleaseNote[];
};

function canonicalEntryWithoutOverride(entry: StrictCatalogEntry): string {
  const { releaseNotesOverride: _ignored, ...rest } = entry;
  return JSON.stringify({
    name: rest.name,
    value: rest.value,
    category: rest.category,
    artifactType: rest.artifactType,
    management: rest.management.managed
      ? {
          managed: true,
          datasource: rest.management.datasource,
          versioning: rest.management.versioning,
          packageName: rest.management.packageName ?? null,
          registryUrl: rest.management.registryUrl ?? null,
        }
      : { managed: false },
    imagePublisher: rest.imagePublisher ?? null,
    component: rest.component ?? null,
    notes: rest.notes ?? null,
  });
}

function overridesEqual(
  left: ReleaseNotesOverride | undefined,
  right: ReleaseNotesOverride | undefined,
): boolean {
  return (
    (left === undefined && right === undefined) ||
    (left !== undefined &&
      right !== undefined &&
      (left.url ?? "") === (right.url ?? "") &&
      left.summary === right.summary)
  );
}

function parseCatalogPair(
  beforeCatalogText: string,
  afterCatalogText: string,
):
  | { ok: true; before: FullCatalog; after: FullCatalog }
  | { ok: false; reason: string } {
  try {
    const beforeRaw: unknown = JSON.parse(beforeCatalogText);
    const afterRaw: unknown = JSON.parse(afterCatalogText);
    CatalogSchema.parse(beforeRaw);
    CatalogSchema.parse(afterRaw);
    return {
      ok: true,
      before: FullCatalogSchema.parse(beforeRaw),
      after: FullCatalogSchema.parse(afterRaw),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      reason: `catalog.json schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function changeCommitKey(dependency: string, commitSha: string): string {
  return `${dependency}\u{0}${commitSha}`;
}

function bareCatalogVersion(value: string | undefined): string | undefined {
  return value?.split("@")[0];
}

async function inspectCatalogEntryPair(input: {
  index: number;
  beforeEntry: StrictCatalogEntry;
  afterEntry: StrictCatalogEntry | undefined;
  missingNames: ReadonlySet<string>;
  eligibleNames: ReadonlySet<string>;
  verifyHttp200: HttpUrlCheckFn;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; addedOverride: ReleaseNotesOverride | undefined }
  | { ok: false; reason: string }
> {
  const { beforeEntry, afterEntry } = input;
  if (afterEntry?.name !== beforeEntry.name) {
    return {
      ok: false,
      reason: `Catalog entry order or identity changed at index ${String(input.index)}.`,
    };
  }
  if (
    canonicalEntryWithoutOverride(beforeEntry) !==
    canonicalEntryWithoutOverride(afterEntry)
  ) {
    return {
      ok: false,
      reason: `Non-override field modified on catalog entry '${beforeEntry.name}'.`,
    };
  }
  if (
    overridesEqual(
      beforeEntry.releaseNotesOverride,
      afterEntry.releaseNotesOverride,
    )
  ) {
    return { ok: true, addedOverride: undefined };
  }
  if (!input.missingNames.has(beforeEntry.name)) {
    return {
      ok: false,
      reason: `releaseNotesOverride modified on entry '${beforeEntry.name}' which is not in missing list.`,
    };
  }
  if (!input.eligibleNames.has(beforeEntry.name)) {
    return {
      ok: false,
      reason: `releaseNotesOverride modified on entry '${beforeEntry.name}' whose current catalog version '${beforeEntry.value}' has no missing release note.`,
    };
  }
  const candidateOverride = afterEntry.releaseNotesOverride;
  if (candidateOverride?.url === undefined) {
    return {
      ok: false,
      reason: `Newly added releaseNotesOverride on '${beforeEntry.name}' must include a verifiable URL.`,
    };
  }
  if (!(await input.verifyHttp200(candidateOverride.url, input.signal))) {
    return {
      ok: false,
      reason: `releaseNotesOverride.url '${candidateOverride.url}' on '${beforeEntry.name}' did not return HTTP 200.`,
    };
  }
  return { ok: true, addedOverride: candidateOverride };
}

function collectEligibleTargetVersions(
  beforeEntries: readonly StrictCatalogEntry[],
  missingChanges: readonly DependencyChange[],
): Map<string, string> {
  const eligibleTargetVersions = new Map<string, string>();
  for (const beforeEntry of beforeEntries) {
    const currentVersion = bareCatalogVersion(beforeEntry.value);
    if (
      currentVersion !== undefined &&
      missingChanges.some(
        (change) =>
          change.name === beforeEntry.name &&
          change.newValue !== undefined &&
          change.newVersion === currentVersion,
      )
    ) {
      eligibleTargetVersions.set(beforeEntry.name, currentVersion);
    }
  }
  return eligibleTargetVersions;
}

function collectResolvedReleaseNotes(
  missingChanges: readonly DependencyChange[],
  verifiedOverrides: ReadonlyMap<string, ReleaseNotesOverride>,
  eligibleTargetVersions: ReadonlyMap<string, string>,
): { resolvedNotes: ReleaseNote[]; resolvedMissingCount: number } {
  const notesByVersionKey = new Map<string, ReleaseNote>();
  let resolvedMissingCount = 0;
  for (const change of missingChanges) {
    const override = verifiedOverrides.get(change.name);
    const targetVersion = eligibleTargetVersions.get(change.name);
    if (
      override === undefined ||
      targetVersion === undefined ||
      change.newValue === undefined ||
      change.newVersion !== targetVersion
    ) {
      continue;
    }
    resolvedMissingCount += 1;
    notesByVersionKey.set(`${change.name}\u{0}${targetVersion}`, {
      dependency: change.name,
      version: targetVersion,
      notes: override.summary,
      url: override.url,
      source: "catalog-override",
    });
  }
  return {
    resolvedNotes: [...notesByVersionKey.values()],
    resolvedMissingCount,
  };
}

export async function verifyCatalogReleaseNoteDiff(input: {
  beforeCatalogText: string;
  afterCatalogText: string;
  changes: readonly DependencyChange[];
  missing: readonly MissingReleaseNote[];
  verifyHttp200?: HttpUrlCheckFn;
  signal?: AbortSignal;
}): Promise<
  | {
      valid: true;
      verifiedOverrides: Map<string, ReleaseNotesOverride>;
      resolvedNotes: ReleaseNote[];
      resolvedMissingCount: number;
    }
  | { valid: false; reason: string }
> {
  const verifyHttp200 = input.verifyHttp200 ?? verifyUrlHttp200;
  const parsed = parseCatalogPair(
    input.beforeCatalogText,
    input.afterCatalogText,
  );
  if (!parsed.ok) {
    return { valid: false, reason: parsed.reason };
  }
  if (parsed.before.$schema !== parsed.after.$schema) {
    return {
      valid: false,
      reason: "catalog.json $schema header was modified.",
    };
  }
  if (parsed.before.entries.length !== parsed.after.entries.length) {
    return { valid: false, reason: "Catalog entries were added or removed." };
  }

  const missingNames = new Set(input.missing.map((item) => item.dependency));
  const missingKeys = new Set(
    input.missing.map((item) =>
      changeCommitKey(item.dependency, item.commitSha),
    ),
  );
  const missingChanges = input.changes.filter((change) =>
    missingKeys.has(changeCommitKey(change.name, change.commitSha)),
  );
  const eligibleTargetVersions = collectEligibleTargetVersions(
    parsed.before.entries,
    missingChanges,
  );
  const eligibleNames = new Set(eligibleTargetVersions.keys());
  const verifiedOverrides = new Map<string, ReleaseNotesOverride>();

  for (const [index, beforeEntry] of parsed.before.entries.entries()) {
    const inspected = await inspectCatalogEntryPair({
      index,
      beforeEntry,
      afterEntry: parsed.after.entries[index],
      missingNames,
      eligibleNames,
      verifyHttp200,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    if (!inspected.ok) {
      return { valid: false, reason: inspected.reason };
    }
    if (inspected.addedOverride !== undefined) {
      verifiedOverrides.set(beforeEntry.name, inspected.addedOverride);
    }
  }

  const resolved = collectResolvedReleaseNotes(
    missingChanges,
    verifiedOverrides,
    eligibleTargetVersions,
  );
  return {
    valid: true,
    verifiedOverrides,
    ...resolved,
  };
}

export function buildReleaseNotesRemediationPrompt(
  changes: readonly DependencyChange[],
  missing: readonly MissingReleaseNote[],
): string {
  const missingKeys = new Set(
    missing.map((item) => changeCommitKey(item.dependency, item.commitSha)),
  );
  const relevantChanges = changes.filter((change) =>
    missingKeys.has(changeCommitKey(change.name, change.commitSha)),
  );
  return [
    "You are proposing authoritative `releaseNotesOverride` entries in `packages/version-catalog/src/catalog.json` for weekly dependency changes whose automated release-note lookup came back unavailable.",
    "",
    "Missing release notes:",
    JSON.stringify({ missing, relevantChanges }, null, 2),
    "",
    "Instructions:",
    `1. Edit ONLY \`${VERSION_CATALOG_PATH}\`.`,
    "2. For each missing event whose `newValue` matches the entry's current `value` in `catalog.json`, use web search to locate an authoritative upstream release note, changelog, or version announcement URL returning HTTP 200.",
    '3. Add `"releaseNotesOverride": { "url": "<https://...>", "summary": "<1-3 factual sentences summarizing changes in the target version>" }` ONLY when an authoritative HTTP-200 URL exists. Omit any dependency where no trustworthy source exists or whose current catalog version is not among the missing events.',
    "4. NEVER add, remove, or reorder entries in `entries`, and NEVER modify `value`, `management`, `notes`, or any field other than `releaseNotesOverride` on the listed missing entries.",
    "5. Keep valid JSON formatting. Do NOT run `git commit` or `git push`.",
  ].join("\n");
}

async function verifyCatalogOverridesInRepo(input: {
  repoDir: string;
  changedFiles: readonly string[];
  beforeCatalogText: string;
  changes: readonly DependencyChange[];
  missing: readonly MissingReleaseNote[];
  verifyHttp200?: HttpUrlCheckFn;
  commandRunner?: GitCommandRunner;
  signal?: AbortSignal;
}): Promise<CodexPrVerificationResult<ReleaseNote[]>> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  const totalMissingCount = input.missing.length;

  if (!input.changedFiles.includes(VERSION_CATALOG_PATH)) {
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: totalMissingCount,
      verificationSummary: "No releaseNotesOverride changes were proposed.",
      extra: [],
    };
  }

  const afterCatalogText = await Bun.file(
    `${input.repoDir}/${VERSION_CATALOG_PATH}`,
  ).text();
  const diffResult = await verifyCatalogReleaseNoteDiff({
    beforeCatalogText: input.beforeCatalogText,
    afterCatalogText,
    changes: input.changes,
    missing: input.missing,
    ...(input.verifyHttp200 === undefined
      ? {}
      : { verifyHttp200: input.verifyHttp200 }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });

  if (!diffResult.valid) {
    await revertSingleRepoPath(
      input.repoDir,
      VERSION_CATALOG_PATH,
      commandRunner,
    );
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: totalMissingCount,
      verificationSummary:
        `Rejected proposed catalog.json edit: ${diffResult.reason}`.slice(
          0,
          500,
        ),
      extra: [],
    };
  }

  const resolvedCount = diffResult.resolvedMissingCount;
  const unresolvedCount = Math.max(0, totalMissingCount - resolvedCount);
  if (resolvedCount === 0) {
    await revertSingleRepoPath(
      input.repoDir,
      VERSION_CATALOG_PATH,
      commandRunner,
    );
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: totalMissingCount,
      verificationSummary:
        "No verified releaseNotesOverride additions remained after catalog diff inspection.",
      extra: [],
    };
  }

  return {
    verifiedFiles: [VERSION_CATALOG_PATH],
    resolvedCount,
    unresolvedCount,
    autoMerge: false,
    verificationSummary: `Verified schema, field-level catalog diff, and HTTP 200 reachability for ${String(resolvedCount)}/${String(totalMissingCount)} missing release-note events.`,
    extra: diffResult.resolvedNotes,
  };
}

export async function proposeMissingReleaseNoteOverrides(
  changes: DependencyChange[],
  missing: MissingReleaseNote[],
  deps: CodexPrRemediationDependencies & {
    verifyHttp200?: HttpUrlCheckFn;
  } = {},
): Promise<ProposeReleaseNoteOverridesResult> {
  if (missing.length === 0) {
    return {
      remediation: {
        outcome: "no-changes",
        changedFiles: [],
        resolvedCount: 0,
        unresolvedCount: 0,
        summary: "No missing release notes required overrides.",
      },
      resolvedNotes: [],
    };
  }

  let beforeCatalogText = "";
  const outcome = await runCodexPrRemediationWithExtra<ReleaseNote[]>(
    {
      slug: "deps-release-notes",
      callSite: "deps-summary-remediation",
      failureTypePrefix: "DepsSummaryRemediation",
      prTitle: "chore(version-catalog): add missing release-note overrides",
      prWhy: `Weekly \`deps-summary-weekly\` had ${String(missing.length)} catalog ${missing.length === 1 ? "entry" : "entries"} without automatically resolvable release notes.`,
      prWhat:
        "Added verified `releaseNotesOverride` summaries and HTTP-200 source URLs in `packages/version-catalog/src/catalog.json`.",
      prompt: buildReleaseNotesRemediationPrompt(changes, missing),
      autoMerge: false,
      cloneArgs: ["--filter=blob:none", "--single-branch", "--branch=main"],
      isAllowedPath: (path) => path === VERSION_CATALOG_PATH,
      prepareRepo: async (repoDir) => {
        beforeCatalogText = await Bun.file(
          `${repoDir}/${VERSION_CATALOG_PATH}`,
        ).text();
      },
      verifyAndFilter: (repoDir, changedFiles, context) =>
        verifyCatalogOverridesInRepo({
          repoDir,
          changedFiles,
          beforeCatalogText,
          changes,
          missing,
          commandRunner: context.commandRunner,
          signal: context.signal,
          ...(deps.verifyHttp200 === undefined
            ? {}
            : { verifyHttp200: deps.verifyHttp200 }),
        }),
    },
    deps,
  );

  return {
    remediation: outcome.remediation,
    resolvedNotes: outcome.extra ?? [],
  };
}
