import simpleGit from "simple-git";
import {
  getFullDependencyChanges,
  fetchReleaseNotesBetween,
  getGitHubRepoForImage,
  type FullDependencyDiff,
} from "./index.ts";
import {
  HELM_CHART_GITHUB_REPOS,
  HELM_CHART_APP_REPOS,
  DOCKER_IMAGE_GITHUB_REPOS,
} from "./repo-mappings.ts";
import { formatEmailHtml, sendEmail } from "./email-formatter.ts";
import { summarizeWithLLM } from "./llm-summary.ts";
import {
  DependencyInfoSchema,
  ArtifactHubSchema,
  GitHubReleaseSchema,
  GitHubReleasesArraySchema,
  type DependencyInfo,
  type ReleaseNotes,
  type FailedFetch,
} from "./main-schemas.ts";

const VERSIONS_FILE_PATH = "src/cdk8s/src/versions.ts";
const REPO_URL = "https://github.com/shepherdjerred/homelab.git";

// Parse command line args
// Usage: bun run src/main.ts [days] [--dry-run]
const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysArg = args.find((a) => !a.startsWith("--"));
const DAYS_TO_LOOK_BACK = daysArg ? Number.parseInt(daysArg, 10) : 7;

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

function findMatchingAddedLine(
  lines: string[],
  startIndex: number,
  versionRegex: RegExp,
  name: string,
  renovateComment: string | null,
  oldVersion: string,
): DependencyInfo | null {
  for (let j = startIndex; j < lines.length; j++) {
    const nextLine = lines[j];
    if (!nextLine) {
      continue;
    }
    if (!nextLine.startsWith("+") || nextLine.startsWith("+++")) {
      continue;
    }

    const newVersionMatch = versionRegex.exec(nextLine);
    if (!newVersionMatch) {
      continue;
    }

    const newName = newVersionMatch[1] ?? newVersionMatch[2];
    if (newName !== name) {
      continue;
    }

    const newVersion = newVersionMatch[3];
    if (!newVersion) {
      continue;
    }

    return parseRenovateComment(renovateComment, name, oldVersion, newVersion);
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
    if (!line) {
      continue;
    }

    // Look for removed lines (old version)
    if (line.startsWith("-") && !line.startsWith("---")) {
      const versionMatch = versionRegex.exec(line);
      if (versionMatch) {
        // Name is either group 1 (quoted) or group 2 (unquoted)
        const name = versionMatch[1] ?? versionMatch[2];
        const oldVersion = versionMatch[3];
        if (!name || !oldVersion) {
          continue;
        }

        // Look backwards for the renovate comment (should be directly above)
        // The comment must be on the immediately preceding line (in context)
        let renovateComment: string | null = null;
        const prevLine = lines[i - 1];
        if (prevLine?.includes("// renovate:")) {
          renovateComment = prevLine;
        }

        // Look for the corresponding added line
        const matchedInfo = findMatchingAddedLine(
          lines,
          i + 1,
          versionRegex,
          name,
          renovateComment,
          oldVersion,
        );
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
  if (!comment) {
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
  if (!datasource || !validDatasources.includes(datasource)) {
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
      const releaseNotesList = await fetchReleaseNotes(change);
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

async function fetchReleaseNotes(dep: DependencyInfo): Promise<ReleaseNotes[]> {
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
      const helmNotes = await fetchHelmReleaseNotes(dep);
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
  if (!owner || !repo) {
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

async function tryArtifactHubFallback(
  depName: string,
  newVersion: string,
): Promise<ReleaseNotes | null> {
  try {
    const searchUrl = `https://artifacthub.io/api/v1/packages/helm/${depName}`;
    const response = await fetch(searchUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "homelab-dependency-summary",
      },
    });

    if (!response.ok) {
      return null;
    }

    const rawData: unknown = await response.json();
    const parsed = ArtifactHubSchema.safeParse(rawData);
    if (!parsed.success) {
      return null;
    }

    const repoUrl = parsed.data.repository?.url;
    if (!repoUrl) {
      return null;
    }

    const repoMatch = /github\.com\/([^/]+\/[^/]+)/i.exec(repoUrl);
    if (!repoMatch?.[1]) {
      return null;
    }

    const [owner, repo] = repoMatch[1].split("/");
    if (!owner || !repo) {
      return null;
    }

    const releases = await fetchGitHubReleases(owner, repo, newVersion);
    if (!releases) {
      return null;
    }

    return {
      dependency: depName,
      version: newVersion,
      notes: releases.body,
      url: releases.url,
      source: "helm-chart",
    };
  } catch {
    return null;
  }
}

async function fetchDockerReleaseNotes(
  dep: DependencyInfo,
): Promise<ReleaseNotes | null> {
  // Look up the GitHub repo for this Docker image
  const githubRepo = DOCKER_IMAGE_GITHUB_REPOS[dep.name];

  // Build list of repos to try (mapped repo first, then fallback patterns)
  const reposToTry: string[] = [];

  if (githubRepo) {
    reposToTry.push(githubRepo);
  }

  // Try common GitHub repo patterns as fallback
  const [org, image] = dep.name.split("/");
  if (org && image) {
    reposToTry.push(
      `${org}/${image}`,
      `${org}/docker-${image}`,
      `${image}/${image}`, // e.g., syncthing/syncthing
    );
  }

  // Use the full fallback chain (GitHub Releases → CHANGELOG.md → Git Compare + LLM)
  for (const repoPath of reposToTry) {
    const notes = await fetchReleaseNotesBetween(
      repoPath,
      dep.oldVersion,
      dep.newVersion,
    );

    if (notes.length > 0) {
      return {
        dependency: dep.name,
        version: dep.newVersion,
        notes: notes.map((n) => n.body).join("\n\n---\n\n"),
        url: notes[0]?.url,
        source: "docker",
      };
    }
  }

  return null;
}

async function fetchHelmReleaseNotes(
  dep: DependencyInfo,
): Promise<ReleaseNotes[]> {
  const results: ReleaseNotes[] = [];

  // 1. Try to fetch Helm chart release notes
  const chartRepo = HELM_CHART_GITHUB_REPOS[dep.name];
  if (chartRepo) {
    const [owner, repo] = chartRepo.split("/");
    if (owner && repo) {
      // Try chart-specific tag formats
      const chartTags = [
        `${dep.name}-${dep.newVersion}`,
        dep.newVersion,
        `v${dep.newVersion}`,
      ];

      for (const tag of chartTags) {
        const releases = await fetchGitHubReleases(owner, repo, tag);
        if (releases) {
          results.push({
            dependency: `${dep.name} (helm chart)`,
            version: dep.newVersion,
            notes: releases.body,
            url: releases.url,
            source: "helm-chart",
          });
          break;
        }
      }
    }
  }

  // 2. Try to fetch underlying app release notes
  const appRepo = HELM_CHART_APP_REPOS[dep.name];
  if (appRepo && appRepo !== chartRepo) {
    const [owner, repo] = appRepo.split("/");
    if (owner && repo) {
      // For app releases, we need to look up what app version corresponds to the chart version
      // For now, try to find releases that might match
      const releases = await fetchGitHubReleases(owner, repo, dep.newVersion);
      if (releases) {
        results.push({
          dependency: `${dep.name} (app)`,
          version: dep.newVersion,
          notes: releases.body,
          url: releases.url,
          source: "app",
        });
      }
    }
  }

  // 3. If still nothing, try ArtifactHub API as fallback
  if (results.length === 0) {
    const artifactHubResult = await tryArtifactHubFallback(
      dep.name,
      dep.newVersion,
    );
    if (artifactHubResult) {
      results.push(artifactHubResult);
    }
  }

  // 4. NEW: Fetch transitive dependency release notes
  if (dep.registryUrl) {
    try {
      console.log(`  Fetching transitive dependencies for ${dep.name}...`);
      const transitiveDiff = await getFullDependencyChanges(
        dep.name,
        dep.registryUrl,
        dep.oldVersion,
        dep.newVersion,
      );

      // Store the diff for later formatting
      transitiveDepsDiffs.set(dep.name, transitiveDiff);

      // Fetch release notes for image updates
      for (const imageUpdate of transitiveDiff.images.updated) {
        const githubRepo = getGitHubRepoForImage(imageUpdate.repository);
        if (githubRepo) {
          console.log(
            `    Fetching release notes for ${imageUpdate.repository} (${imageUpdate.oldTag} -> ${imageUpdate.newTag})...`,
          );
          const notes = await fetchReleaseNotesBetween(
            githubRepo,
            imageUpdate.oldTag,
            imageUpdate.newTag,
          );

          for (const note of notes) {
            results.push({
              dependency: `${dep.name} → ${imageUpdate.repository}`,
              version: note.version,
              notes: note.body,
              url: note.url,
              source: "app", // Transitive image dependency
            });
          }
        }
      }

      // Fetch release notes for sub-chart updates
      for (const chartUpdate of transitiveDiff.charts.updated) {
        const subChartRepo =
          HELM_CHART_GITHUB_REPOS[chartUpdate.name] ??
          HELM_CHART_APP_REPOS[chartUpdate.name];
        if (subChartRepo) {
          console.log(
            `    Fetching release notes for sub-chart ${chartUpdate.name} (${chartUpdate.oldVersion} -> ${chartUpdate.newVersion})...`,
          );
          const notes = await fetchReleaseNotesBetween(
            subChartRepo,
            chartUpdate.oldVersion,
            chartUpdate.newVersion,
          );

          for (const note of notes) {
            results.push({
              dependency: `${dep.name} → ${chartUpdate.name}`,
              version: note.version,
              notes: note.body,
              url: note.url,
              source: "helm-chart",
            });
          }
        }
      }

      console.log(
        `  Found ${String(transitiveDiff.images.updated.length)} image updates, ${String(transitiveDiff.charts.updated.length)} sub-chart updates`,
      );
    } catch (error) {
      console.warn(
        `  Failed to fetch transitive deps for ${dep.name}: ${String(error)}`,
      );
    }
  }

  return results;
}

// Store transitive dependency diffs for email formatting
const transitiveDepsDiffs = new Map<string, FullDependencyDiff>();

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "homelab-dependency-summary",
  };

  const token = Bun.env["GITHUB_TOKEN"];
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

async function fetchGitHubReleases(
  owner: string,
  repo: string,
  version: string,
): Promise<{ body: string; url: string } | null> {
  const headers = getGitHubHeaders();

  // Try exact version tag first
  const tagsToTry = [
    version,
    `v${version}`,
    version.replace(/^v/, ""),
    `${repo}-${version}`, // Some repos use repo-name-version format
  ];

  for (const tag of tagsToTry) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
    try {
      const response = await fetch(url, { headers });

      if (response.ok) {
        const rawData: unknown = await response.json();
        const parsed = GitHubReleaseSchema.safeParse(rawData);
        if (
          parsed.success &&
          parsed.data.body &&
          parsed.data.body.length > 50
        ) {
          return {
            body: parsed.data.body,
            url:
              parsed.data.html_url ??
              `https://github.com/${owner}/${repo}/releases/tag/${tag}`,
          };
        }
      }
    } catch {
      continue;
    }
  }

  // Fall back to fetching recent releases and finding a match
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=20`;
    const response = await fetch(url, { headers });

    if (response.ok) {
      const rawData: unknown = await response.json();
      const parsed = GitHubReleasesArraySchema.safeParse(rawData);

      if (parsed.success) {
        // Find release containing our version
        const matchingRelease = parsed.data.find(
          (r) =>
            r.tag_name?.includes(version) ??
            r.tag_name?.includes(version.replace(/^v/, "")),
        );

        if (matchingRelease?.body && matchingRelease.body.length > 50) {
          return {
            body: matchingRelease.body,
            url:
              matchingRelease.html_url ??
              `https://github.com/${owner}/${repo}/releases`,
          };
        }
      }
    }
  } catch {
    // Fall through
  }

  return null;
}

// Run the script
await main();
