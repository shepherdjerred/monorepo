import { z } from "zod/v4";
import {
  botCloneCacheDir,
  rootInstallWithoutHooks,
} from "#activities/bot-clone.ts";
import {
  runCodexPrRemediation,
  type CodexPrRemediationDependencies,
  type CodexPrVerificationResult,
} from "#activities/remediation/codex-pr-remediation.ts";
import { revertSingleRepoPath } from "#activities/remediation/codex-pr-remediation-git.ts";
import { FullCatalogSchema } from "#activities/remediation/version-catalog-schema.ts";
import {
  runCommand as defaultRunCommand,
  type GitCommandRunner,
} from "#activities/scout/scout-season-refresh-git.ts";
import type { ReportRemediationV1 } from "#shared/reports/report.ts";
import type { MainVulnScanResult } from "./main-vuln-scan.ts";
import {
  groupVulnerabilities,
  type GroupedVulnerability,
} from "./main-vuln-scan-report.ts";

const VERSION_CATALOG_PATH = "packages/version-catalog/src/catalog.json";
const WorkspacePackageJsonSchema = z.object({
  name: z.string().min(1).optional(),
});

export function isAllowedMainVulnPath(path: string): boolean {
  const forbidden =
    path === ".trivyignore" ||
    path.includes("node_modules/") ||
    path.startsWith("sandbox/") ||
    path.endsWith("/.trivyignore");
  return (
    !forbidden &&
    (path === "package.json" ||
      path === "bun.lock" ||
      path === VERSION_CATALOG_PATH ||
      /^packages\/.+\/package\.json$/u.test(path) ||
      /^(?:.+\/)?(?:Cargo\.(?:toml|lock)|go\.(?:mod|sum)|pyproject\.toml|uv\.lock)$/u.test(
        path,
      ))
  );
}

export function buildMainVulnRemediationPrompt(
  fixableGroups: readonly GroupedVulnerability[],
  unfixableCount: number,
): string {
  const advisoryLines = fixableGroups
    .map((group) => {
      const titleSuffix = group.title === undefined ? "" : ` — ${group.title}`;
      const urlSuffix =
        group.primaryUrl === undefined ? "" : ` (${group.primaryUrl})`;
      return `- [${group.severity}] ${group.vulnerabilityId}: ${group.pkgName}@${group.installedVersion} -> fixed in >= ${group.fixedVersion ?? "unknown"} | targets: ${group.targets.join(", ")}${titleSuffix}${urlSuffix}`;
    })
    .join("\n");

  return [
    "You are remediating fixable HIGH/CRITICAL Trivy dependency advisories detected on `main`.",
    "",
    `Fixable advisories (${String(fixableGroups.length)}; ${String(unfixableCount)} unfixable advisories omitted):`,
    advisoryLines,
    "",
    "Instructions:",
    "1. Upgrade affected dependencies and pins to `>= fixedVersion` across the reported target manifests/lockfiles.",
    "2. This is a single Bun workspace with one root `bun.lock`: use `bun update` or edit `package.json` + `bun install --ignore-scripts` at the repository root. NEVER use npm, yarn, pnpm, or per-package lockfiles.",
    "3. For Cargo, Go, uv, or `packages/version-catalog/src/catalog.json` targets, update only the affected manifest/lockfile/catalog pin.",
    "4. NEVER edit `.trivyignore` or source code files. Only dependency manifests, lockfiles, and `packages/version-catalog/src/catalog.json` are permitted.",
    "5. Verify `bun install --frozen-lockfile --ignore-scripts` and focused typechecks on touched packages before finishing. Do NOT run `git commit` or `git push`.",
  ].join("\n");
}

function escapeRegExp(literal: string): string {
  return literal.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function fileStillPinsVulnerableVersion(
  content: string,
  pkgName: string,
  installedVersion: string,
): boolean {
  const escapedPkg = escapeRegExp(pkgName);
  const escapedVer = escapeRegExp(installedVersion);
  const patterns = [
    new RegExp(String.raw`${escapedPkg}@${escapedVer}(?![\w.-])`, "u"),
    new RegExp(
      String.raw`"${escapedPkg}"[^\n]{0,120}"[^"]*\b${escapedVer}\b"`,
      "u",
    ),
    new RegExp(
      String.raw`name\s*=\s*"${escapedPkg}"[\s\S]{0,160}?version\s*=\s*"${escapedVer}"`,
      "u",
    ),
    new RegExp(String.raw`\b${escapedPkg}\s+v?${escapedVer}\b`, "u"),
  ];
  return patterns.some((pattern) => pattern.test(content));
}

export async function countAddressedVulnerabilities(
  repoDir: string,
  verifiedFiles: readonly string[],
  allGroups: readonly GroupedVulnerability[],
): Promise<{ resolvedCount: number; unresolvedCount: number }> {
  const verifiedSet = new Set(verifiedFiles);
  const contentCache = new Map<string, string>();

  const readTarget = async (target: string): Promise<string> => {
    const cached = contentCache.get(target);
    if (cached !== undefined) {
      return cached;
    }
    const file = Bun.file(`${repoDir}/${target}`);
    const text = (await file.exists()) ? await file.text() : "";
    contentCache.set(target, text);
    return text;
  };

  let resolvedCount = 0;
  let unresolvedCount = 0;
  for (const group of allGroups) {
    if (group.fixedVersion === undefined) {
      unresolvedCount += 1;
      continue;
    }
    const targetsTouched = group.targets.every((target) =>
      verifiedSet.has(target),
    );
    if (!targetsTouched) {
      unresolvedCount += 1;
      continue;
    }
    let anyTargetStillVulnerable = false;
    for (const target of group.targets) {
      const content = await readTarget(target);
      if (
        fileStillPinsVulnerableVersion(
          content,
          group.pkgName,
          group.installedVersion,
        )
      ) {
        anyTargetStillVulnerable = true;
        break;
      }
    }
    if (anyTargetStillVulnerable) {
      unresolvedCount += 1;
    } else {
      resolvedCount += 1;
    }
  }
  return { resolvedCount, unresolvedCount };
}

async function resolveTouchedWorkspaceNames(
  repoDir: string,
  changedFiles: readonly string[],
): Promise<string[]> {
  const names: string[] = [];
  for (const file of changedFiles) {
    if (!/^packages\/.+\/package\.json$/u.test(file)) {
      continue;
    }
    const parsed = WorkspacePackageJsonSchema.parse(
      await Bun.file(`${repoDir}/${file}`).json(),
    );
    if (parsed.name !== undefined) {
      names.push(parsed.name);
    }
  }
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

async function revertAllCandidates(
  repoDir: string,
  changedFiles: readonly string[],
  commandRunner: GitCommandRunner,
): Promise<void> {
  for (const file of changedFiles) {
    await revertSingleRepoPath(repoDir, file, commandRunner);
  }
}

export async function verifyMainVulnRemediation(input: {
  repoDir: string;
  changedFiles: readonly string[];
  allGroups: readonly GroupedVulnerability[];
  commandRunner?: GitCommandRunner;
}): Promise<CodexPrVerificationResult> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  const totalCount = input.allGroups.length;
  if (input.changedFiles.length === 0) {
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: totalCount,
      verificationSummary:
        "No allowed manifest or lockfile changes were produced.",
    };
  }

  try {
    if (input.changedFiles.includes(VERSION_CATALOG_PATH)) {
      FullCatalogSchema.parse(
        await Bun.file(`${input.repoDir}/${VERSION_CATALOG_PATH}`).json(),
      );
    }

    const jsManifestTouched = input.changedFiles.some(
      (file) => file === "bun.lock" || file.endsWith("package.json"),
    );
    const commandEnv = {
      ENVIRONMENT: undefined,
      BUN_INSTALL_CACHE_DIR: botCloneCacheDir(input.repoDir),
    };

    if (jsManifestTouched) {
      await commandRunner(
        ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
        { cwd: input.repoDir, env: commandEnv },
      );
      const workspaceNames = await resolveTouchedWorkspaceNames(
        input.repoDir,
        input.changedFiles,
      );
      if (workspaceNames.length > 0) {
        const filterArgs = workspaceNames.map(
          (pkgName) => `--filter=${pkgName}`,
        );
        await commandRunner(
          ["bunx", "--no-install", "turbo", "run", "typecheck", ...filterArgs],
          { cwd: input.repoDir, env: commandEnv },
        );
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await revertAllCandidates(input.repoDir, input.changedFiles, commandRunner);
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: totalCount,
      verificationSummary:
        `Reverted candidate dependency changes after verification failure: ${message}`.slice(
          0,
          500,
        ),
    };
  }

  const counts = await countAddressedVulnerabilities(
    input.repoDir,
    input.changedFiles,
    input.allGroups,
  );
  if (counts.resolvedCount === 0) {
    await revertAllCandidates(input.repoDir, input.changedFiles, commandRunner);
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: totalCount,
      verificationSummary:
        "Reverted manifest changes because no reported HIGH/CRITICAL advisory version pin moved.",
    };
  }

  return {
    verifiedFiles: [...input.changedFiles],
    resolvedCount: counts.resolvedCount,
    unresolvedCount: counts.unresolvedCount,
    autoMerge: false,
    verificationSummary: `Verified frozen lockfile and manifest consistency; addressed ${String(counts.resolvedCount)}/${String(totalCount)} grouped HIGH/CRITICAL advisories (${String(counts.unresolvedCount)} remaining).`,
  };
}

export async function remediateMainVulnerabilities(
  scanResult: MainVulnScanResult,
  deps: CodexPrRemediationDependencies = {},
): Promise<ReportRemediationV1> {
  const allGroups = groupVulnerabilities(scanResult.vulnerabilities);
  const fixableGroups = allGroups.filter(
    (group) => group.fixedVersion !== undefined,
  );
  if (fixableGroups.length === 0) {
    return {
      outcome: "no-changes",
      changedFiles: [],
      resolvedCount: 0,
      unresolvedCount: allGroups.length,
      summary: "No HIGH/CRITICAL advisories have a published fixed version.",
    };
  }

  const unfixableCount = allGroups.length - fixableGroups.length;
  return runCodexPrRemediation(
    {
      slug: "vuln-remediation",
      callSite: "main-vuln-remediation",
      failureTypePrefix: "MainVulnRemediation",
      prTitle: "fix(deps): remediate Trivy HIGH/CRITICAL advisories",
      prWhy: `Weekly \`main-vuln-scan-weekly\` reported ${String(fixableGroups.length)} fixable HIGH/CRITICAL advisory groups on \`main@${scanResult.repoSha.slice(0, 12)}\`.`,
      prWhat:
        "Upgraded affected dependency pins and lockfiles to patched versions (`autoMerge: false` for human review).",
      prompt: buildMainVulnRemediationPrompt(fixableGroups, unfixableCount),
      autoMerge: false,
      isAllowedPath: isAllowedMainVulnPath,
      prepareRepo: async (repoDir) => {
        await rootInstallWithoutHooks(repoDir);
      },
      verifyAndFilter: (repoDir, changedFiles) =>
        verifyMainVulnRemediation({
          repoDir,
          changedFiles,
          allGroups,
          ...(deps.commandRunner === undefined
            ? {}
            : { commandRunner: deps.commandRunner }),
        }),
    },
    deps,
  );
}

export const mainVulnRemediationActivities = {
  async remediateMainVulnerabilities(
    scanResult: MainVulnScanResult,
  ): Promise<ReportRemediationV1> {
    return remediateMainVulnerabilities(scanResult);
  },
};

export type MainVulnRemediationActivities =
  typeof mainVulnRemediationActivities;
