import { createHash } from "node:crypto";
import type {
  RankedRenovateUpdate,
  RenovateTarget,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { z } from "zod";

import { sanitizeHttpsUrl } from "#activities/ops/renovate-delta/semver-utils.ts";
import {
  AgeConfigSchema,
  bakeForUpdate,
  type AgeConfig,
} from "./ranking-age.ts";

const UpdateSchema = z.object({
  branchName: z.string().optional(),
  updateType: z.string().optional(),
  newValue: z.string().nullish(),
  newVersion: z.string().nullish(),
  newDigest: z.string().nullish(),
  currentVersion: z.string().nullish(),
  releaseTimestamp: z.string().nullish(),
  pendingChecks: z.boolean().optional(),
  pendingVersions: z.array(z.string()).optional(),
  isBreaking: z.boolean().optional(),
  isLockfileUpdate: z.boolean().optional(),
  newName: z.string().nullish(),
});

const DependencySchema = z.object({
  depName: z.string().optional(),
  packageName: z.string().optional(),
  datasource: z.string().optional(),
  depType: z.string().optional(),
  currentValue: z.string().nullish(),
  currentVersion: z.string().nullish(),
  lockedVersion: z.string().nullish(),
  fixedVersion: z.string().nullish(),
  currentDigest: z.string().nullish(),
  sourceUrl: z.string().nullish(),
  changelogUrl: z.string().nullish(),
  skipReason: z.string().optional(),
  lookupFailed: z.boolean().optional(),
  warnings: z.array(z.unknown()).optional(),
  updates: z.array(UpdateSchema).optional(),
});

const RepositoryReportSchema = z.object({
  packageFiles: z.record(
    z.string(),
    z.array(
      z.object({
        packageFile: z.string().min(1),
        deps: z.array(DependencySchema),
      }),
    ),
  ),
  problems: z.array(z.unknown()).optional(),
});

const ReportSchema = z.object({
  repositories: z.record(z.string(), RepositoryReportSchema),
  problems: z.array(z.unknown()).optional(),
});

type Dependency = z.infer<typeof DependencySchema>;
type LookupUpdate = z.infer<typeof UpdateSchema>;
type Bake = RankedRenovateUpdate["bake"];
type Declaration = {
  readonly manager: string;
  readonly name: string;
  readonly lookupName: string;
  readonly datasource: string | null;
};

export type LookupTarget = {
  readonly target: RenovateTarget;
  readonly branch: string;
  readonly lookupName: string;
  readonly installedVersion: string | null;
  readonly devOnly: boolean;
  readonly breaking: boolean;
  readonly updateType: string | undefined;
  readonly evidenceUrls: string[];
  readonly bake: Bake;
  readonly blocker: string | null;
};

export type LookupInventory = {
  readonly targets: LookupTarget[];
  readonly incompleteLookups: number;
  readonly warnings: string[];
};

function safeRepoPath(path: string): boolean {
  return (
    !path.includes("\\") &&
    !path.includes(":") &&
    path
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          part.toLowerCase() !== ".git",
      )
  );
}

function declaration(manager: string, dependency: Dependency): Declaration {
  const name = dependency.depName ?? dependency.packageName ?? "";
  return {
    manager,
    name,
    lookupName: dependency.packageName ?? name,
    datasource: dependency.datasource ?? null,
  };
}

const GroupRuleSchema = z.object({
  groupName: z.string().min(1),
  matchDepNames: z.array(z.string()).optional(),
  matchPackageNames: z.array(z.string()).optional(),
  matchDatasources: z.array(z.string()).optional(),
  matchManagers: z.array(z.string()).optional(),
});

function matchesGroupField(
  value: string | null,
  selectors: readonly string[] | undefined,
): boolean {
  if (selectors === undefined || value === null || value === "") return true;
  return selectors.some((selector) => {
    const regex = /^\/(.+)\/(i?)$/u.exec(selector);
    // Ignore negative selectors here to conservatively include groups that
    // could have a missing member. Renovate still chooses the exact branches.
    return regex?.[1] === undefined
      ? selector === "*" ||
          selector.startsWith("!") ||
          new Bun.Glob(selector.toLowerCase()).match(value.toLowerCase())
      : new RegExp(regex[1], regex[2]).test(value);
  });
}

function matchingGroups(config: AgeConfig, member: Declaration): string[] {
  return (config.packageRules ?? []).flatMap((raw) => {
    const rule = GroupRuleSchema.safeParse(raw);
    if (!rule.success) return [];
    const group = rule.data;
    return matchesGroupField(member.name, group.matchDepNames) &&
      matchesGroupField(member.lookupName, group.matchPackageNames) &&
      matchesGroupField(member.manager, group.matchManagers) &&
      matchesGroupField(member.datasource, group.matchDatasources)
      ? [group.groupName]
      : [];
  });
}

export function publicEvidenceUrl(raw: string | undefined): string | undefined {
  const safe = sanitizeHttpsUrl(raw);
  if (safe === undefined) return undefined;
  const url = new URL(safe);
  if (url.username !== "" || url.password !== "") return undefined;
  url.search = "";
  return url.href;
}

function evidenceUrls(dependency: Dependency): string[] {
  return [dependency.changelogUrl, dependency.sourceUrl].flatMap((url) => {
    const safe = publicEvidenceUrl(url ?? undefined);
    return safe === undefined ? [] : [safe];
  });
}

type LookupDeclaration = {
  readonly manager: string;
  readonly filePath: string;
  readonly dependency: Dependency;
};

function earlyBlocker(
  dependency: Dependency,
  update: LookupUpdate,
  lookupName: string,
): string | null {
  if (dependency.skipReason === "malicious-update-proposed") {
    return "Renovate flagged the target as malicious.";
  }
  if (update.branchName === undefined) {
    return "Renovate did not assign a branch to this proposal.";
  }
  if (
    update.newName != null &&
    update.newName !== "" &&
    update.newName !== lookupName
  ) {
    return "Package replacement needs review of the new dependency and its consumers.";
  }
  if (update.isLockfileUpdate === true) {
    return "This lockfile-only target needs exact resolution verification.";
  }
  return dependency.currentDigest != null &&
    dependency.currentDigest !== "" &&
    (update.newDigest == null || update.newDigest === "")
    ? "The new digest could not be verified by Renovate."
    : null;
}

function installedVersionFor(
  dependency: Dependency,
  currentVersion: string | null,
): string | null {
  const resolved = dependency.lockedVersion ?? dependency.fixedVersion;
  if (resolved != null) return resolved;
  if (currentVersion === null || dependency.currentValue == null) return null;
  const value = dependency.currentValue.trim();
  // Bare Cargo and NuGet declarations can resolve to a newer version.
  if (dependency.datasource === "crate" && !value.startsWith("=")) return null;
  if (dependency.datasource === "nuget" && !/^\[[^,]+\]$/u.test(value))
    return null;
  const declared = (
    value.startsWith("npm:") ? value.slice(value.lastIndexOf("@") + 1) : value
  )
    .replace(/^={1,2}\s*/u, "")
    .replace(/^\[([^,]+)\]$/u, "$1");
  const exact =
    dependency.datasource === "npm"
      ? /^v?\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/u.test(declared)
      : /^v?\d+(?:\.\d+)*(?:[-+][\w.+-]+)?$/u.test(declared);
  return exact &&
    declared.replace(/^v(?=\d)/u, "") ===
      currentVersion.replace(/^v(?=\d)/u, "")
    ? currentVersion
    : null;
}

function targetForLookup(
  source: LookupDeclaration,
  update: LookupUpdate,
  config: AgeConfig,
  now: Date,
): LookupTarget | null {
  const { manager, filePath, dependency } = source;
  const { name, lookupName } = declaration(manager, dependency);
  const targetValue = update.newValue ?? update.newVersion;
  if (
    name === "" ||
    targetValue == null ||
    targetValue === "" ||
    !safeRepoPath(filePath)
  )
    return null;
  const currentVersion =
    dependency.currentVersion ?? update.currentVersion ?? null;
  const installedVersion = installedVersionFor(dependency, currentVersion);
  const target: RenovateTarget = {
    manager,
    datasource: dependency.datasource ?? null,
    packageName: name,
    filePath,
    currentValue: dependency.currentValue ?? null,
    currentVersion,
    currentDigest: dependency.currentDigest ?? null,
    targetValue,
    targetVersion: update.newVersion ?? null,
    digest: update.newDigest ?? null,
  };
  return {
    target,
    lookupName,
    branch:
      update.branchName ??
      `unassigned:${manager}:${filePath}:${name}:${targetValue}`,
    installedVersion,
    devOnly:
      dependency.depType === "devDependencies" ||
      dependency.depType === "dev-dependencies",
    updateType: update.updateType,
    breaking: update.isBreaking === true,
    evidenceUrls: evidenceUrls(dependency),
    bake: bakeForUpdate({
      config,
      lookupName,
      datasource: target.datasource,
      update,
      now,
    }),
    blocker: earlyBlocker(dependency, update, lookupName),
  };
}

function pendingAlternative(
  entry: LookupTarget,
  version: string,
): LookupTarget {
  return {
    ...entry,
    branch: `${entry.branch}#pending:${version}`,
    target: {
      ...entry.target,
      targetValue: version,
      targetVersion: version,
      digest: null,
    },
    bake: {
      state: "unknown",
      eligibleAt: null,
      reason:
        "Renovate reports this newer version is pending and has not emitted its exact update.",
    },
    blocker: "The exact update is still pending upstream checks.",
  };
}

export function parseRenovateLookupInventory(
  raw: unknown,
  rawConfig: unknown,
  now: Date,
): LookupInventory {
  const report = ReportSchema.parse(raw);
  const repository = Object.values(report.repositories);
  const lookup = repository[0];
  if (
    lookup === undefined ||
    repository.length !== 1 ||
    Object.keys(lookup.packageFiles).length === 0
  ) {
    throw new Error(
      "Renovate did not return an inventory for the cloned repository.",
    );
  }
  const config = AgeConfigSchema.parse(rawConfig);
  const declarations = lookupDeclarations(lookup.packageFiles);
  const incompleteIdentities = new Set<string>();
  const incompleteGroups = new Set<string>();
  const results = declarations.map((item) =>
    collectDeclarationTargets(item, config, now),
  );
  const incomplete = results.filter((result) => result.incomplete);
  for (const result of incomplete) {
    const member = result.member;
    if (member.lookupName !== "") {
      incompleteIdentities.add(
        JSON.stringify([member.datasource, member.lookupName]),
      );
    }
    for (const group of matchingGroups(config, member))
      incompleteGroups.add(group);
  }
  const targets = results.flatMap((result) => result.targets);
  const incompleteLookups = incomplete.length;
  const problems =
    (report.problems?.length ?? 0) + (lookup.problems?.length ?? 0);
  const warnings = [
    ...(incompleteLookups === 0
      ? []
      : [
          `Renovate reported incomplete lookup data for ${String(incompleteLookups)} declarations or proposals.`,
        ]),
    ...(problems === 0
      ? []
      : [
          `Renovate reported ${String(problems)} lookup or configuration problems.`,
        ]),
  ];
  return {
    targets: targets.map((entry) => {
      if (entry.blocker !== null) return entry;
      const affected =
        incompleteIdentities.has(
          JSON.stringify([entry.target.datasource, entry.lookupName]),
        ) ||
        matchingGroups(config, {
          manager: entry.target.manager,
          name: entry.target.packageName,
          lookupName: entry.lookupName,
          datasource: entry.target.datasource,
        }).some((group) => incompleteGroups.has(group));
      return affected
        ? {
            ...entry,
            blocker:
              "A related declaration has incomplete Renovate lookup evidence.",
          }
        : entry;
    }),
    incompleteLookups: incompleteLookups + problems,
    warnings,
  };
}

function lookupDeclarations(
  packageFiles: z.infer<typeof RepositoryReportSchema>["packageFiles"],
): LookupDeclaration[] {
  return Object.entries(packageFiles).flatMap(([reportManager, files]) => {
    const manager =
      reportManager === "regex" || reportManager === "jsonata"
        ? `custom.${reportManager}`
        : reportManager;
    return files.flatMap((file) =>
      file.deps.map((dependency) => ({
        filePath: file.packageFile,
        manager,
        dependency,
      })),
    );
  });
}

function collectDeclarationTargets(
  item: LookupDeclaration,
  config: AgeConfig,
  now: Date,
) {
  const { dependency, manager } = item;
  const targets: LookupTarget[] = [];
  let incomplete =
    dependency.lookupFailed === true ||
    dependency.skipReason === "internal-error" ||
    (dependency.warnings?.length ?? 0) > 0;
  for (const update of dependency.updates ?? []) {
    const entry = targetForLookup(item, update, config, now);
    if (entry === null) {
      incomplete = true;
      continue;
    }
    targets.push(entry);
    for (const version of update.pendingVersions ?? []) {
      if (version !== entry.target.targetVersion)
        targets.push(pendingAlternative(entry, version));
    }
  }
  return { incomplete, member: declaration(manager, dependency), targets };
}

export function targetKey(target: RenovateTarget): string {
  return JSON.stringify([
    target.manager,
    target.filePath,
    target.packageName,
    target.currentValue,
    target.currentDigest,
    target.targetValue,
    target.targetVersion,
    target.digest,
  ]);
}

export function candidateId(
  branch: string,
  targets: readonly RenovateTarget[],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        branch,
        targets.map((target) => targetKey(target)).sort(),
      ]),
    )
    .digest("hex");
}
