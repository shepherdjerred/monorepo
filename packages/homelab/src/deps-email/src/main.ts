/**
 * Standalone script to generate and send weekly dependency update summaries.
 * Run via: bun run src/main.ts
 *
 * Required environment variables:
 * - OPENAI_API_KEY: OpenAI API key for GPT-5.1
 * - POSTAL_HOST: Postal server hostname (e.g., postal.tailnet-1a49.ts.net)
 * - POSTAL_API_KEY: Postal server API key
 * - RECIPIENT_EMAIL: Email address to send the summary to
 * - SENDER_EMAIL: (optional) Email address to send from (default: updates@homelab.local)
 */

import simpleGit from "simple-git";
import OpenAI from "openai";
import { z } from "zod";
import { createPostalClientFromEnv } from "./postal-client.js";
import {
  getFullDependencyChanges,
  fetchReleaseNotesBetween,
  getGitHubRepoForImage,
  type FullDependencyDiff,
} from "./index.js";
import { HELM_CHART_GITHUB_REPOS, HELM_CHART_APP_REPOS, DOCKER_IMAGE_GITHUB_REPOS } from "./repo-mappings.js";

// Schema for parsed dependency info from renovate comments
const DependencyInfoSchema = z.object({
  name: z.string(),
  datasource: z.enum(["helm", "docker", "github-releases", "custom.papermc"]),
  registryUrl: z.string().optional(),
  oldVersion: z.string(),
  newVersion: z.string(),
});

type DependencyInfo = z.infer<typeof DependencyInfoSchema>;

// Schema for ArtifactHub response
const ArtifactHubSchema = z.object({
  links: z
    .array(
      z.object({
        name: z.string().optional(),
        url: z.string().optional(),
      }),
    )
    .optional(),
  repository: z
    .object({
      url: z.string().optional(),
    })
    .optional(),
});

// Schema for GitHub release response
const GitHubReleaseSchema = z.object({
  body: z.string().optional(),
  html_url: z.string().optional(),
  tag_name: z.string().optional(),
});

const GitHubReleasesArraySchema = z.array(GitHubReleaseSchema);

// Schema for release notes
type ReleaseNotes = {
  dependency: string;
  version: string;
  notes: string;
  url?: string;
  source: "helm-chart" | "app" | "docker" | "github";
};

// Track failed fetches
type FailedFetch = {
  dependency: string;
  reason: string;
};

const VERSIONS_FILE_PATH = "src/cdk8s/src/versions.ts";
const REPO_URL = "https://github.com/shepherdjerred/homelab.git";

// Parse command line args
// Usage: bun run src/main.ts [days] [--dry-run]
const args = Bun.argv.slice(2);
const dryRun = args.includes("--dry-run");
const daysArg = args.find((a) => !a.startsWith("--"));
const DAYS_TO_LOOK_BACK = daysArg ? parseInt(daysArg, 10) : 7;

async function main() {
  console.log(`Starting dependency summary generation (looking back ${String(DAYS_TO_LOOK_BACK)} days)...`);

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
      await sendEmail("No Dependency Updates This Week", "<p>No dependencies were updated in the last week.</p>");
      return;
    }

    console.log(`Found ${String(changes.length)} dependency changes`);

    // Step 2: Fetch release notes for each change
    const { notes: releaseNotes, failed: failedFetches } = await fetchAllReleaseNotes(changes);

    // Step 3: Summarize with GPT-5.1
    const summary = await summarizeWithLLM(changes, releaseNotes);

    // Step 4: Format and send email
    const htmlContent = formatEmailHtml(changes, summary, failedFetches);
    await sendEmail("Weekly Dependency Update Summary", htmlContent);
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
    if (!existing) {
      uniqueChanges.set(change.name, change);
    } else {
      // Keep the oldest "old" version and newest "new" version
      uniqueChanges.set(change.name, {
        ...change,
        oldVersion: existing.oldVersion,
      });
    }
  }

  return Array.from(uniqueChanges.values());
}

function parseDiff(diff: string): DependencyInfo[] {
  const changes: DependencyInfo[] = [];
  const lines = diff.split("\n");

  // Match both quoted keys ("name": "value") and unquoted keys (name: "value")
  const versionRegex = /(?:"([^"]+)"|([a-zA-Z0-9_-]+)):\s*"([^"]+)"/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Look for removed lines (old version)
    if (line.startsWith("-") && !line.startsWith("---")) {
      const versionMatch = versionRegex.exec(line);
      if (versionMatch) {
        // Name is either group 1 (quoted) or group 2 (unquoted)
        const name = versionMatch[1] ?? versionMatch[2];
        const oldVersion = versionMatch[3];
        if (!name || !oldVersion) continue;

        // Look backwards for the renovate comment (should be directly above)
        // The comment must be on the immediately preceding line (in context)
        let renovateComment: string | null = null;
        const prevLine = lines[i - 1];
        if (prevLine?.includes("// renovate:")) {
          renovateComment = prevLine;
        }

        // Look for the corresponding added line
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (!nextLine) continue;
          if (nextLine.startsWith("+") && !nextLine.startsWith("+++")) {
            const newVersionMatch = versionRegex.exec(nextLine);
            if (newVersionMatch) {
              const newName = newVersionMatch[1] ?? newVersionMatch[2];
              if (newName === name) {
                const newVersion = newVersionMatch[3];
                if (!newVersion) continue;
                const info = parseRenovateComment(renovateComment, name, oldVersion, newVersion);
                if (info) {
                  changes.push(info);
                }
                break;
              }
            }
          }
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

  const datasourceRegex = /datasource=([^\s]+)/;
  const registryUrlRegex = /registryUrl=([^\s]+)/;

  const datasourceMatch = datasourceRegex.exec(comment);
  const registryUrlMatch = registryUrlRegex.exec(comment);

  if (!datasourceMatch) {
    return null;
  }

  const datasource = datasourceMatch[1];
  const validDatasources = ["helm", "docker", "github-releases", "custom.papermc"];
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
      console.log(`Fetching release notes for ${change.name} (${change.datasource})...`);
      const releaseNotesList = await fetchReleaseNotes(change);
      if (releaseNotesList.length > 0) {
        for (const note of releaseNotesList) {
          const preview = note.notes.slice(0, 100).replace(/\n/g, " ");
          console.log(`  ✓ [${note.source}] Got ${String(note.notes.length)} chars: "${preview}..."`);
          notes.push(note);
        }
      } else {
        console.log(`  ✗ No release notes found`);
        failed.push({ dependency: change.name, reason: "No GitHub releases found" });
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
      if (note) results.push(note);
      break;
    }
    case "docker": {
      const note = await fetchDockerReleaseNotes(dep);
      if (note) results.push(note);
      break;
    }
    case "helm": {
      // For Helm, fetch both chart notes AND underlying app notes
      const helmNotes = await fetchHelmReleaseNotes(dep);
      results.push(...helmNotes);
      break;
    }
  }

  return results;
}

async function fetchGitHubReleaseNotes(dep: DependencyInfo): Promise<ReleaseNotes | null> {
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

async function fetchDockerReleaseNotes(dep: DependencyInfo): Promise<ReleaseNotes | null> {
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
    const notes = await fetchReleaseNotesBetween(repoPath, dep.oldVersion, dep.newVersion);

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

async function fetchHelmReleaseNotes(dep: DependencyInfo): Promise<ReleaseNotes[]> {
  const results: ReleaseNotes[] = [];

  // 1. Try to fetch Helm chart release notes
  const chartRepo = HELM_CHART_GITHUB_REPOS[dep.name];
  if (chartRepo) {
    const [owner, repo] = chartRepo.split("/");
    if (owner && repo) {
      // Try chart-specific tag formats
      const chartTags = [`${dep.name}-${dep.newVersion}`, dep.newVersion, `v${dep.newVersion}`];

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
    try {
      const searchUrl = `https://artifacthub.io/api/v1/packages/helm/${dep.name}`;
      const response = await fetch(searchUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "homelab-dependency-summary",
        },
      });

      if (response.ok) {
        const rawData: unknown = await response.json();
        const parsed = ArtifactHubSchema.safeParse(rawData);

        if (parsed.success && parsed.data.repository?.url) {
          const repoMatch = /github\.com\/([^/]+\/[^/]+)/i.exec(parsed.data.repository.url);
          if (repoMatch?.[1]) {
            const [owner, repo] = repoMatch[1].split("/");
            if (owner && repo) {
              const releases = await fetchGitHubReleases(owner, repo, dep.newVersion);
              if (releases) {
                results.push({
                  dependency: dep.name,
                  version: dep.newVersion,
                  notes: releases.body,
                  url: releases.url,
                  source: "helm-chart",
                });
              }
            }
          }
        }
      }
    } catch {
      // Continue
    }
  }

  // 4. NEW: Fetch transitive dependency release notes
  if (dep.registryUrl) {
    try {
      console.log(`  Fetching transitive dependencies for ${dep.name}...`);
      const transitiveDiff = await getFullDependencyChanges(dep.name, dep.registryUrl, dep.oldVersion, dep.newVersion);

      // Store the diff for later formatting
      transitiveDepsDiffs.set(dep.name, transitiveDiff);

      // Fetch release notes for image updates
      for (const imageUpdate of transitiveDiff.images.updated) {
        const githubRepo = getGitHubRepoForImage(imageUpdate.repository);
        if (githubRepo) {
          console.log(
            `    Fetching release notes for ${imageUpdate.repository} (${imageUpdate.oldTag} -> ${imageUpdate.newTag})...`,
          );
          const notes = await fetchReleaseNotesBetween(githubRepo, imageUpdate.oldTag, imageUpdate.newTag);

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
        const subChartRepo = HELM_CHART_GITHUB_REPOS[chartUpdate.name] ?? HELM_CHART_APP_REPOS[chartUpdate.name];
        if (subChartRepo) {
          console.log(
            `    Fetching release notes for sub-chart ${chartUpdate.name} (${chartUpdate.oldVersion} -> ${chartUpdate.newVersion})...`,
          );
          const notes = await fetchReleaseNotesBetween(subChartRepo, chartUpdate.oldVersion, chartUpdate.newVersion);

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
      console.warn(`  Failed to fetch transitive deps for ${dep.name}: ${String(error)}`);
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
        if (parsed.success && parsed.data.body && parsed.data.body.length > 50) {
          return {
            body: parsed.data.body,
            url: parsed.data.html_url ?? `https://github.com/${owner}/${repo}/releases/tag/${tag}`,
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
          (r) => r.tag_name?.includes(version) ?? r.tag_name?.includes(version.replace(/^v/, "")),
        );

        if (matchingRelease?.body && matchingRelease.body.length > 50) {
          return {
            body: matchingRelease.body,
            url: matchingRelease.html_url ?? `https://github.com/${owner}/${repo}/releases`,
          };
        }
      }
    }
  } catch {
    // Fall through
  }

  return null;
}

async function summarizeWithLLM(changes: DependencyInfo[], releaseNotes: ReleaseNotes[]): Promise<string> {
  const apiKey = Bun.env["OPENAI_API_KEY"];
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set, skipping LLM summarization");
    return "LLM summarization skipped - API key not configured";
  }

  const openai = new OpenAI({ apiKey });

  // Build the prompt
  const changesText = changes.map((c) => `- ${c.name}: ${c.oldVersion} → ${c.newVersion} (${c.datasource})`).join("\n");

  const notesText = releaseNotes
    .map((n) => `## ${n.dependency} [${n.source}] (${n.version})\n${n.notes}\n${n.url ? `URL: ${n.url}` : ""}`)
    .join("\n\n");

  // Note which dependencies we couldn't fetch notes for
  const fetchedDeps = new Set(releaseNotes.map((n) => n.dependency.replace(/ \((helm chart|app)\)$/, "")));
  const missingNotes = changes.filter((c) => !fetchedDeps.has(c.name)).map((c) => c.name);
  const missingNotesText =
    missingNotes.length > 0
      ? `\n\nNote: Release notes could NOT be fetched for: ${missingNotes.join(", ")}. Be conservative with recommendations for these.`
      : "";

  const prompt = `You are a DevOps engineer reviewing weekly dependency updates for a homelab Kubernetes infrastructure.

Here are the dependencies that were updated this week:
${changesText}

Here are the available release notes:
${notesText}
${missingNotesText}

Please provide a concise summary that includes:
1. **Breaking Changes**: Any breaking changes that require immediate action
2. **Security Updates**: Any security-related fixes
3. **Notable New Features**: Features that might be useful for a homelab setup
4. **Recommended Actions**: Specific things to check or configure after these updates

IMPORTANT: Only include information that is EXPLICITLY mentioned in the release notes provided above.
Do NOT speculate or make assumptions about changes that are not documented.
For dependencies without release notes, simply note that no information is available.

Keep the summary actionable and focused on what matters for a self-hosted homelab environment.
Format the response in HTML for email.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.1",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 8000, // GPT-5.1 uses tokens for reasoning + output
    });

    const choice = completion.choices[0];
    return choice?.message.content ?? "Failed to generate summary";
  } catch (error) {
    console.error(`OpenAI API error: ${String(error)}`);
    return "Failed to generate LLM summary";
  }
}

function formatEmailHtml(changes: DependencyInfo[], llmSummary: string, failedFetches: FailedFetch[]): string {
  const changesHtml = changes
    .map(
      (c) => `
        <tr>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.name}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.oldVersion}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.newVersion}</td>
          <td style="padding: 8px; border: 1px solid #ddd;">${c.datasource}</td>
        </tr>`,
    )
    .join("");

  const failedHtml =
    failedFetches.length > 0
      ? `
  <h2>⚠️ Failed to Fetch Release Notes (${String(failedFetches.length)})</h2>
  <p style="color: #b45309; background-color: #fef3c7; padding: 10px; border-radius: 4px;">
    The following dependencies could not have their release notes fetched.
    The AI summary for these may be less accurate.
  </p>
  <ul>
    ${failedFetches.map((f) => `<li><strong>${f.dependency}</strong>: ${f.reason}</li>`).join("\n    ")}
  </ul>
  `
      : "";

  // Format transitive dependencies section
  const transitiveDepsHtml = formatTransitiveDepsHtml();

  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; margin-top: 30px; }
    h3 { color: #3b82f6; margin-top: 20px; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th { background-color: #2563eb; color: white; padding: 12px 8px; text-align: left; }
    td { padding: 8px; border: 1px solid #ddd; }
    tr:nth-child(even) { background-color: #f8fafc; }
    .summary { background-color: #f0f9ff; border-left: 4px solid #2563eb; padding: 15px; margin: 20px 0; }
    .transitive { background-color: #f0fdf4; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; }
    .transitive-section { margin-left: 20px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 0.9em; }
    .dep-chain { color: #6b7280; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Weekly Dependency Update Summary</h1>
  <p>Generated on ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>

  <h2>Direct Dependency Updates (${String(changes.length)})</h2>
  <table>
    <thead>
      <tr>
        <th>Dependency</th>
        <th>Old Version</th>
        <th>New Version</th>
        <th>Source</th>
      </tr>
    </thead>
    <tbody>
      ${changesHtml}
    </tbody>
  </table>

  ${transitiveDepsHtml}

  ${failedHtml}

  <h2>AI Summary</h2>
  <div class="summary">
    ${llmSummary}
  </div>

  <div class="footer">
    <p>This summary was automatically generated by your homelab dependency monitoring system.</p>
    <p>Repository: <a href="https://github.com/shepherdjerred/homelab">shepherdjerred/homelab</a></p>
  </div>
</body>
</html>`;
}

function formatTransitiveDepsHtml(): string {
  if (transitiveDepsDiffs.size === 0) {
    return "";
  }

  const sections: string[] = [];

  for (const [chartName, diff] of transitiveDepsDiffs) {
    const hasChanges =
      diff.images.updated.length > 0 || diff.charts.updated.length > 0 || diff.appVersions.updated.length > 0;

    if (!hasChanges) continue;

    let sectionHtml = `<h3>${chartName} - Transitive Updates</h3><div class="transitive-section">`;

    // Sub-chart updates
    if (diff.charts.updated.length > 0) {
      sectionHtml += `
      <h4>Sub-chart Updates</h4>
      <table>
        <thead>
          <tr>
            <th>Chart</th>
            <th>Old Version</th>
            <th>New Version</th>
          </tr>
        </thead>
        <tbody>
          ${diff.charts.updated
            .map(
              (c) => `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${c.name}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${c.oldVersion}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${c.newVersion}</td>
            </tr>
          `,
            )
            .join("")}
        </tbody>
      </table>`;
    }

    // Image updates
    if (diff.images.updated.length > 0) {
      sectionHtml += `
      <h4>Container Image Updates</h4>
      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>Old Tag</th>
            <th>New Tag</th>
          </tr>
        </thead>
        <tbody>
          ${diff.images.updated
            .map((img) => {
              const registry = img.registry ? `${img.registry}/` : "";
              return `
            <tr>
              <td style="padding: 8px; border: 1px solid #ddd;">${registry}${img.repository}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${img.oldTag}</td>
              <td style="padding: 8px; border: 1px solid #ddd;">${img.newTag}</td>
            </tr>
          `;
            })
            .join("")}
        </tbody>
      </table>`;
    }

    // AppVersion updates
    if (diff.appVersions.updated.length > 0) {
      sectionHtml += `
      <h4>AppVersion Updates</h4>
      <ul>
        ${diff.appVersions.updated
          .map((a) => `<li><strong>${a.chartName}</strong>: ${a.oldAppVersion} → ${a.newAppVersion}</li>`)
          .join("\n")}
      </ul>`;
    }

    sectionHtml += "</div>";
    sections.push(sectionHtml);
  }

  if (sections.length === 0) {
    return "";
  }

  return `
  <h2>Transitive Dependency Updates</h2>
  <div class="transitive">
    <p>The following indirect dependencies were also updated as part of the direct dependency changes above.</p>
  </div>
  ${sections.join("\n")}
  `;
}

async function sendEmail(subject: string, htmlContent: string): Promise<void> {
  // In dry-run mode, output to markdown file
  if (dryRun) {
    // Convert HTML to markdown
    const markdown = htmlContent
      // Remove style blocks
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      // Convert headers
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n# $1\n")
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n## $1\n")
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n### $1\n")
      // Convert strong/bold
      .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
      .replace(/<b>(.*?)<\/b>/gi, "**$1**")
      // Convert em/italic
      .replace(/<em>(.*?)<\/em>/gi, "*$1*")
      .replace(/<i>(.*?)<\/i>/gi, "*$1*")
      // Convert links
      .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
      // Convert table - build proper markdown table
      .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match, tableContent: string) => {
        const rows: string[] = [];
        const rowMatches = tableContent.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) ?? [];
        rowMatches.forEach((row, index) => {
          const cells: string[] = [];
          const cellMatches = row.match(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi) ?? [];
          cellMatches.forEach((cell) => {
            const content = cell
              .replace(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/i, "$1")
              .replace(/<[^>]+>/g, "")
              .trim();
            cells.push(content);
          });
          rows.push("| " + cells.join(" | ") + " |");
          // Add separator after header row
          if (index === 0) {
            rows.push("|" + cells.map(() => "---").join("|") + "|");
          }
        });
        return "\n" + rows.join("\n") + "\n";
      })
      // Convert list items
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/li>/gi, "")
      // Convert paragraphs and divs to newlines
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/div>/gi, "\n")
      .replace(/<div[^>]*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      // Remove remaining tags
      .replace(/<[^>]+>/g, "")
      // Decode HTML entities
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      // Clean up whitespace
      .replace(/\n\s*\n\s*\n/g, "\n\n")
      .trim();

    const outputPath = "dependency-summary.md";
    await Bun.write(outputPath, markdown);
    console.log(`\nDRY RUN - Markdown summary written to: ${outputPath}`);
    return;
  }

  const recipientEmail = Bun.env["RECIPIENT_EMAIL"];
  const senderEmail = Bun.env["SENDER_EMAIL"] ?? "updates@homelab.local";

  if (!recipientEmail) {
    console.error("RECIPIENT_EMAIL not set, cannot send email");
    throw new Error("RECIPIENT_EMAIL not set");
  }

  try {
    const postal = createPostalClientFromEnv();
    await postal.sendEmail({
      to: recipientEmail,
      from: senderEmail,
      subject,
      htmlBody: htmlContent,
      tag: "dependency-summary",
    });

    console.log("Email sent successfully via Postal");
  } catch (error) {
    console.error(`Failed to send email: ${String(error)}`);
    throw error;
  }
}

// Run the script
await main();
