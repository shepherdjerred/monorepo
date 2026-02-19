import simpleGit from "simple-git";
import type { FullDependencyDiff } from "./types.ts";
import { formatEmailHtml, sendEmail } from "./email-formatter.ts";
import { summarizeWithLLM } from "./llm-summary.ts";
import {
  DependencyInfoSchema,
  type DependencyInfo,
  type ReleaseNotes,
  type FailedFetch,
} from "./main-schemas.ts";
import { fetchGitHubReleases } from "./github-releases.ts";
import {
  fetchDockerReleaseNotes,
  fetchHelmReleaseNotes,
} from "./datasource-fetchers.ts";

const VERSIONS_FILE_PATH = "src/cdk8s/src/versions.ts";
const REPO_URL = "https://github.com/shepherdjerred/homelab.git";

// Parse command line args
// Usage: bun run src/main.ts [days] [--dry-run]
const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysArg = args.find((a) => !a.startsWith("--"));
const DAYS_TO_LOOK_BACK =
  daysArg != null && daysArg !== "" ? Number.parseInt(daysArg, 10) : 7;

async function main() {
  console.log(
    `Starting dependency summary generation (looking back ${String(DAYS_TO_LOOK_BACK)} days)...`,
  );

  try {
    await generateAndSendSummary();
    console.log("Weekly dependency summary sent successfully!");
  } catch (error) {
    console.error(`Failed to generate dependency summary: ${String(error)}`);
    process.exit(1);
  }
}

async function generateAndSendSummary() {
  // Clone repo to temp directory for analysis
  const id = crypto.randomUUID();
  const tempDir = `/tmp/homelab-dep-summary-${id}`;

  // Create temp directory
  await Bun.$`mkdir -p ${tempDir}`;
  console.log(`Cloning repo to ${tempDir}`);

  try {
    const git = simpleGit();
    await git.clone(REPO_URL, tempDir, ["--depth", "100"]); // Shallow clone with enough history

    // Step 1: Get dependency changes from git history
    const changes = await getVersionChanges(tempDir);
    if (changes.length === 0) {
      console.log("No dependency changes in the last week");
      await sendEmail(
        "No Dependency Updates This Week",
        "<p>No dependencies were updated in the last week.</p>",
        dryRun,
      );
      return;
    }

    console.log(`Found ${String(changes.length)} dependency changes`);

    // Step 2: Fetch release notes for each change
    const { notes: releaseNotes, failed: failedFetches } =
      await fetchAllReleaseNotes(changes);

    // Step 3: Summarize with GPT-5.1
    const summary = await summarizeWithLLM(changes, releaseNotes);

    // Step 4: Format and send email
    const htmlContent = formatEmailHtml(
      changes,
      summary,
      failedFetches,
      transitiveDepsDiffs,
    );
    await sendEmail("Weekly Dependency Update Summary", htmlContent, dryRun);
  } finally {
    // Cleanup temp directory
    await Bun.$`rm -rf ${tempDir}`;
    console.log("Cleaned up temp directory");
  }
}

async function getVersionChanges(repoPath: string): Promise<DependencyInfo[]> {
  const git = simpleGit(repoPath);
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - DAYS_TO_LOOK_BACK);
  const dateStr = lookbackDate.toISOString().split("T")[0];
  const sinceDate = dateStr ?? "";

  // Get commits that modified versions.ts in the last week
  const log = await git.log({
    file: VERSIONS_FILE_PATH,
    "--since": sinceDate,
  });

  if (log.all.length === 0) {
    return [];
  }

  console.log(`Found ${String(log.all.length)} commits modifying versions.ts`);

  const changes: DependencyInfo[] = [];

  // For each commit, get the diff to extract version changes
  for (const commit of log.all) {
    try {
      // Use raw() with --no-ext-diff to get standard unified diff format
      const diff = await git.raw([
        "diff",
        "--no-ext-diff",
        "-U3",
        `${commit.hash}^`,
        commit.hash,
        "--",
        VERSIONS_FILE_PATH,
      ]);
      const parsedChanges = parseDiff(diff);
      changes.push(...parsedChanges);
    } catch {
      // First commit or other edge case
      console.log(`Could not get diff for commit ${commit.hash}`);
    }
  }

  // Deduplicate by dependency name, keeping the most recent change
  const uniqueChanges = new Map<string, DependencyInfo>();
  for (const change of changes) {
    const existing = uniqueChanges.get(change.name);
    if (existing) {
      // Keep the oldest "old" version and newest "new" version
      uniqueChanges.set(change.name, {
        ...change,
        oldVersion: existing.oldVersion,
      });
    } else {
      uniqueChanges.set(change.name, change);
    }
  }

  return [...uniqueChanges.values()];
}

function findMatchingAddedLine(options: {
  lines: string[];
  startIndex: number;
  versionRegex: RegExp;
  name: string;
  renovateComment: string | null;
  oldVersion: string;
}): DependencyInfo | null {
  for (let j = options.startIndex; j < options.lines.length; j++) {
    const nextLine = options.lines[j];
    if (nextLine == null || nextLine === "") {
      continue;
    }
    if (!nextLine.startsWith("+") || nextLine.startsWith("+++")) {
      continue;
    }

    const newVersionMatch = options.versionRegex.exec(nextLine);
    if (!newVersionMatch) {
      continue;
    }

    const newName = newVersionMatch[1] ?? newVersionMatch[2];
    if (newName !== options.name) {
      continue;
    }

    const newVersion = newVersionMatch[3];
    if (newVersion == null || newVersion === "") {
      continue;
    }

    return parseRenovateComment(
      options.renovateComment,
      options.name,
      options.oldVersion,
      newVersion,
    );
  }
  return null;
}

function parseDiff(diff: string): DependencyInfo[] {
  const changes: DependencyInfo[] = [];
  const lines = diff.split("\n");

  // Match both quoted keys ("name": "value") and unquoted keys (name: "value")
  const versionRegex = /(?:"([^"]+)"|([\w-]+)):\s*"([^"]+)"/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line == null || line === "") {
      continue;
    }

    // Look for removed lines (old version)
    if (line.startsWith("-") && !line.startsWith("---")) {
      const versionMatch = versionRegex.exec(line);
      if (versionMatch) {
        // Name is either group 1 (quoted) or group 2 (unquoted)
        const name = versionMatch[1] ?? versionMatch[2];
        const oldVersion = versionMatch[3];
        if (
          name == null ||
          name === "" ||
          oldVersion == null ||
          oldVersion === ""
        ) {
          continue;
        }

        // Look backwards for the renovate comment (should be directly above)
        // The comment must be on the immediately preceding line (in context)
        let renovateComment: string | null = null;
        const prevLine = lines[i - 1];
        if (prevLine?.includes("// renovate:") === true) {
          renovateComment = prevLine;
        }

        // Look for the corresponding added line
        const matchedInfo = findMatchingAddedLine({
          lines,
          startIndex: i + 1,
          versionRegex,
          name,
          renovateComment,
          oldVersion,
        });
        if (matchedInfo) {
          changes.push(matchedInfo);
        }
      }
    }
  }

  return changes;
}

function parseRenovateComment(
  comment: string | null,
  name: string,
  oldVersion: string,
  newVersion: string,
): DependencyInfo | null {
  if (comment == null || comment === "") {
    return null;
  }

  const datasourceRegex = /datasource=(\S+)/;
  const registryUrlRegex = /registryUrl=(\S+)/;

  const datasourceMatch = datasourceRegex.exec(comment);
  const registryUrlMatch = registryUrlRegex.exec(comment);

  if (!datasourceMatch) {
    return null;
  }

  const datasource = datasourceMatch[1];
  const validDatasources = [
    "helm",
    "docker",
    "github-releases",
    "custom.papermc",
  ];
  if (
    datasource == null ||
    datasource === "" ||
    !validDatasources.includes(datasource)
  ) {
    return null;
  }

  const parsed = DependencyInfoSchema.safeParse({
    name,
    datasource,
    registryUrl: registryUrlMatch?.[1],
    oldVersion: cleanVersion(oldVersion),
    newVersion: cleanVersion(newVersion),
  });

  return parsed.success ? parsed.data : null;
}

function cleanVersion(version: string): string {
  // Remove sha256 digest if present
  return version.split("@")[0] ?? version;
}

async function fetchAllReleaseNotes(
  changes: DependencyInfo[],
): Promise<{ notes: ReleaseNotes[]; failed: FailedFetch[] }> {
  const notes: ReleaseNotes[] = [];
  const failed: FailedFetch[] = [];

  for (const change of changes) {
    try {
      console.log(
        `Fetching release notes for ${change.name} (${change.datasource})...`,
      );
      const releaseNotesList = await fetchReleaseNotesForDep(change);
      if (releaseNotesList.length > 0) {
        for (const note of releaseNotesList) {
          const preview = note.notes.slice(0, 100).replaceAll("\n", " ");
          console.log(
            `  ✓ [${note.source}] Got ${String(note.notes.length)} chars: "${preview}..."`,
          );
          notes.push(note);
        }
      } else {
        console.log(`  ✗ No release notes found`);
        failed.push({
          dependency: change.name,
          reason: "No GitHub releases found",
        });
      }
    } catch (error) {
      console.warn(`  ✗ Failed: ${String(error)}`);
      failed.push({ dependency: change.name, reason: String(error) });
    }
  }

  return { notes, failed };
}

async function fetchReleaseNotesForDep(
  dep: DependencyInfo,
): Promise<ReleaseNotes[]> {
  const results: ReleaseNotes[] = [];

  switch (dep.datasource) {
    case "github-releases": {
      const note = await fetchGitHubReleaseNotes(dep);
      if (note) {
        results.push(note);
      }
      break;
    }
    case "docker": {
      const note = await fetchDockerReleaseNotes(dep);
      if (note) {
        results.push(note);
      }
      break;
    }
    case "helm": {
      // For Helm, fetch both chart notes AND underlying app notes
      const helmNotes = await fetchHelmReleaseNotes(dep, transitiveDepsDiffs);
      results.push(...helmNotes);
      break;
    }
    case "custom.papermc":
      // Custom datasource - no release notes fetching implemented
      break;
  }

  return results;
}

async function fetchGitHubReleaseNotes(
  dep: DependencyInfo,
): Promise<ReleaseNotes | null> {
  // dep.name is like "kubernetes/kubernetes" or "siderolabs/talos"
  const [owner, repo] = dep.name.split("/");
  if (owner == null || owner === "" || repo == null || repo === "") {
    return null;
  }

  const releases = await fetchGitHubReleases(owner, repo, dep.newVersion);
  if (releases) {
    return {
      dependency: dep.name,
      version: dep.newVersion,
      notes: releases.body,
      url: releases.url,
      source: "github",
    };
  }
  return null;
}

// Store transitive dependency diffs for email formatting
const transitiveDepsDiffs = new Map<string, FullDependencyDiff>();

// Run the script
await main();
