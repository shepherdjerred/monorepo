import { captureCommand } from "#activities/command-runner.ts";
import {
  runCodexPrRemediation,
  type CodexPrRemediationDependencies,
  type CodexPrVerificationResult,
} from "#activities/remediation/codex-pr-remediation.ts";
import { revertSingleRepoPath } from "#activities/remediation/codex-pr-remediation-git.ts";
import {
  runCommand as defaultRunCommand,
  type GitCommandRunner,
} from "#activities/scout/scout-season-refresh-git.ts";
import type { ReportRemediationV1 } from "#shared/reports/report.ts";
import {
  parseLycheeReport,
  type DeadLink,
  type LinkRotScanResult,
} from "./link-rot-scan.ts";

const LYCHEEIGNORE_PATH = ".lycheeignore";
const LYCHEE_FINDINGS_EXIT_CODE = 2;

const SPECIFIC_URL_EXCLUSION_PREFIX =
  /^\^https\?:\/\/(?!\.\*(?:$|\/)|\.\+(?:$|\/)|\[\^\/\]\*(?:$|\/)|\[\^\/\]\+(?:$|\/))\S{6,}$/u;

export function normalizeLinkRotSourcePath(source: string): string {
  return source.startsWith("./") ? source.slice(2) : source;
}

export function isAllowedLinkRotPath(
  path: string,
  deadLinks: readonly DeadLink[],
): boolean {
  if (path === LYCHEEIGNORE_PATH) {
    return true;
  }
  if (!/\.(?:md|mdx|markdown)$/iu.test(path)) {
    return false;
  }
  const allowedSources = new Set(
    deadLinks.map((link) => normalizeLinkRotSourcePath(link.source)),
  );
  return allowedSources.has(path);
}

function isMeaningfulCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("#") && trimmed.slice(1).trim().length >= 5;
}

function isSpecificValidExclusionRegex(pattern: string): boolean {
  if (!SPECIFIC_URL_EXCLUSION_PREFIX.test(pattern)) {
    return false;
  }
  try {
    // Validate regex syntax deterministically before lychee consumes .lycheeignore.
    new RegExp(pattern, "u");
    return true;
  } catch {
    return false;
  }
}

function parseRuleSet(text: string): Set<string> {
  return new Set(
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#")),
  );
}

function validateAddedRule(
  rule: string,
  blockHasComment: boolean,
): string | undefined {
  if (!blockHasComment) {
    return `New .lycheeignore rule '${rule}' lacks a preceding '# <reason>' comment line.`;
  }
  return isSpecificValidExclusionRegex(rule)
    ? undefined
    : `New .lycheeignore rule '${rule}' must be a valid host-specific ^https?:// regex without broad wildcards.`;
}

export function validateLycheeIgnoreChanges(
  beforeText: string,
  afterText: string,
): { valid: boolean; reason?: string } {
  const beforeRules = parseRuleSet(beforeText);
  const afterRules = new Set<string>();
  let blockHasComment = false;

  for (const rawLine of afterText.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();
    if (trimmed === "") {
      blockHasComment = false;
      continue;
    }
    if (trimmed.startsWith("#")) {
      blockHasComment ||= isMeaningfulCommentLine(trimmed);
      continue;
    }
    afterRules.add(trimmed);
    if (beforeRules.has(trimmed)) {
      continue;
    }
    const violation = validateAddedRule(trimmed, blockHasComment);
    if (violation !== undefined) {
      return { valid: false, reason: violation };
    }
  }

  for (const existingRule of beforeRules) {
    if (!afterRules.has(existingRule)) {
      return {
        valid: false,
        reason: `Existing .lycheeignore rule '${existingRule}' was removed.`,
      };
    }
  }

  return { valid: true };
}

export function buildLinkRotRemediationPrompt(
  scanResult: LinkRotScanResult,
): string {
  const findingsList = scanResult.deadLinks
    .map((link) => {
      const location =
        link.line === undefined
          ? normalizeLinkRotSourcePath(link.source)
          : `${normalizeLinkRotSourcePath(link.source)}:${String(link.line)}`;
      return `- ${location} -> ${link.url} (${link.status})`;
    })
    .join("\n");

  return [
    "You are repairing dead Markdown documentation links detected by the weekly lychee scan on `main`.",
    "",
    `Repository commit scanned: ${scanResult.repoSha}`,
    `Dead links (${String(scanResult.deadLinks.length)}):`,
    findingsList,
    "",
    "Instructions:",
    "1. Read each affected Markdown file around the broken link.",
    "2. Use web search and repository context to find the live moved destination (returning HTTP 200), or an exact `https://web.archive.org/...` snapshot if the page was permanently retired. Update the Markdown link cleanly without altering surrounding meaning.",
    "3. Add a narrowly anchored `^https?://<host>/...` regex to `.lycheeignore` (immediately preceded by a `# <reason>` comment line) ONLY when a live host blocks automated checkers and cannot be replaced. Never add broad `.*` rules or hide genuinely dead links.",
    "4. Edit ONLY `.lycheeignore` and the exact Markdown files listed above. Never edit code files, `AGENTS.md`, or `CLAUDE.md`.",
    "5. Verify your fixes by running `lychee --config lychee.toml --format json --no-progress <touched-files>`. Do NOT run `git commit` or `git push`.",
  ].join("\n");
}

export type LycheeRunner = (
  repoDir: string,
  sources: readonly string[],
) => Promise<string>;

async function defaultRunLycheeJson(
  repoDir: string,
  sources: readonly string[],
): Promise<string> {
  const { stdout, stderr, exitCode } = await captureCommand(
    [
      "lychee",
      "--config",
      "lychee.toml",
      "--format",
      "json",
      "--no-progress",
      "--",
      ...sources,
    ],
    { cwd: repoDir },
  );
  if (exitCode !== 0 && exitCode !== LYCHEE_FINDINGS_EXIT_CODE) {
    throw new Error(
      `lychee verification failed (exit ${String(exitCode)}): ${stderr.trim() || stdout.trim()}`,
    );
  }
  return stdout;
}

export async function verifyLinkRotRemediation(input: {
  repoDir: string;
  changedFiles: readonly string[];
  originalDeadLinks: readonly DeadLink[];
  beforeLycheeIgnore: string;
  runLychee?: LycheeRunner;
  commandRunner?: GitCommandRunner;
}): Promise<CodexPrVerificationResult> {
  const commandRunner = input.commandRunner ?? defaultRunCommand;
  const runLychee = input.runLychee ?? defaultRunLycheeJson;
  const originalCount = input.originalDeadLinks.length;
  const originalSources = [
    ...new Set(
      input.originalDeadLinks.map((link) =>
        normalizeLinkRotSourcePath(link.source),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right));

  if (input.changedFiles.length === 0 || originalSources.length === 0) {
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: originalCount,
      verificationSummary:
        "No allowed files were modified by the remediation agent.",
    };
  }

  let candidateFiles = [...input.changedFiles];
  if (candidateFiles.includes(LYCHEEIGNORE_PATH)) {
    const afterIgnore = await Bun.file(
      `${input.repoDir}/${LYCHEEIGNORE_PATH}`,
    ).text();
    const ignoreCheck = validateLycheeIgnoreChanges(
      input.beforeLycheeIgnore,
      afterIgnore,
    );
    if (!ignoreCheck.valid) {
      await revertSingleRepoPath(
        input.repoDir,
        LYCHEEIGNORE_PATH,
        commandRunner,
      );
      candidateFiles = candidateFiles.filter(
        (file) => file !== LYCHEEIGNORE_PATH,
      );
    }
  }

  if (candidateFiles.length === 0) {
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: originalCount,
      verificationSummary:
        "Reverted invalid .lycheeignore changes; no verified dead-link fixes remain.",
    };
  }

  let parsed = parseLycheeReport(
    await runLychee(input.repoDir, originalSources),
  );
  let revertedAnyMarkdown = false;

  for (const file of candidateFiles) {
    if (file === LYCHEEIGNORE_PATH) {
      continue;
    }
    const beforeLinks = input.originalDeadLinks.filter(
      (link) => normalizeLinkRotSourcePath(link.source) === file,
    );
    const beforeUrls = new Set(beforeLinks.map((link) => link.url));
    const afterLinks = parsed.deadLinks.filter(
      (link) => normalizeLinkRotSourcePath(link.source) === file,
    );
    const introducedNewDeadLink = afterLinks.some(
      (link) => !beforeUrls.has(link.url),
    );
    const noNetImprovement = afterLinks.length >= beforeLinks.length;
    if (introducedNewDeadLink || noNetImprovement) {
      await revertSingleRepoPath(input.repoDir, file, commandRunner);
      candidateFiles = candidateFiles.filter((candidate) => candidate !== file);
      revertedAnyMarkdown = true;
    }
  }

  if (revertedAnyMarkdown && candidateFiles.length > 0) {
    parsed = parseLycheeReport(await runLychee(input.repoDir, originalSources));
  }

  const remainingCount = parsed.deadLinks.length;
  const resolvedCount = Math.max(0, originalCount - remainingCount);
  if (resolvedCount === 0) {
    for (const file of candidateFiles) {
      await revertSingleRepoPath(input.repoDir, file, commandRunner);
    }
    return {
      verifiedFiles: [],
      resolvedCount: 0,
      unresolvedCount: originalCount,
      verificationSummary: `lychee re-check showed 0 of ${String(originalCount)} dead links resolved.`,
    };
  }

  return {
    verifiedFiles: candidateFiles,
    resolvedCount,
    unresolvedCount: remainingCount,
    autoMerge: remainingCount === 0,
    verificationSummary: `lychee verified ${String(resolvedCount)}/${String(originalCount)} dead links resolved (${String(remainingCount)} remaining).`,
  };
}

export async function remediateLinkRot(
  scanResult: LinkRotScanResult,
  deps: CodexPrRemediationDependencies & { runLychee?: LycheeRunner } = {},
): Promise<ReportRemediationV1> {
  if (scanResult.deadLinks.length === 0) {
    return {
      outcome: "no-changes",
      changedFiles: [],
      resolvedCount: 0,
      unresolvedCount: 0,
      summary: "No dead links required remediation.",
    };
  }

  let beforeLycheeIgnore = "";
  return runCodexPrRemediation(
    {
      slug: "link-rot",
      callSite: "link-rot-remediation",
      failureTypePrefix: "LinkRotRemediation",
      prTitle: "fix(docs): remediate dead documentation links",
      prWhy: `Weekly \`link-rot-scan-weekly\` detected ${String(scanResult.deadLinks.length)} dead documentation ${scanResult.deadLinks.length === 1 ? "link" : "links"} on \`main@${scanResult.repoSha.slice(0, 12)}\`.`,
      prWhat:
        "Updated broken Markdown links to verified live destinations or narrowly scoped `.lycheeignore` exclusions.",
      prompt: buildLinkRotRemediationPrompt(scanResult),
      autoMerge: true,
      isAllowedPath: (path) => isAllowedLinkRotPath(path, scanResult.deadLinks),
      prepareRepo: async (repoDir) => {
        const ignoreFile = Bun.file(`${repoDir}/${LYCHEEIGNORE_PATH}`);
        beforeLycheeIgnore = (await ignoreFile.exists())
          ? await ignoreFile.text()
          : "";
      },
      verifyAndFilter: (repoDir, changedFiles) =>
        verifyLinkRotRemediation({
          repoDir,
          changedFiles,
          originalDeadLinks: scanResult.deadLinks,
          beforeLycheeIgnore,
          ...(deps.runLychee === undefined
            ? {}
            : { runLychee: deps.runLychee }),
          ...(deps.commandRunner === undefined
            ? {}
            : { commandRunner: deps.commandRunner }),
        }),
    },
    deps,
  );
}

export const linkRotRemediationActivities = {
  async remediateLinkRot(
    scanResult: LinkRotScanResult,
  ): Promise<ReportRemediationV1> {
    return remediateLinkRot(scanResult);
  },
};

export type LinkRotRemediationActivities = typeof linkRotRemediationActivities;
