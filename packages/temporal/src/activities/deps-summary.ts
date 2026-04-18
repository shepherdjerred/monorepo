import { simpleGit } from "simple-git";
import OpenAI from "openai";
import { z } from "zod/v4";

const VERSIONS_FILE_PATH = "src/cdk8s/src/versions.ts";
const REPO_URL = "https://github.com/shepherdjerred/homelab.git";

const VERSION_LINE_REGEX = /"([^"]+)":\s*"([^"]+)"/;

function parseVersionLine(
  line: string,
): { name: string; version: string } | undefined {
  const versionMatch = VERSION_LINE_REGEX.exec(line);
  if (versionMatch === null) {
    return undefined;
  }
  const name = versionMatch[1] ?? "";
  const version = (versionMatch[2] ?? "").split("@")[0] ?? "";
  return { name, version };
}

function handleRemovedLine(
  line: string,
  changes: Map<string, DependencyChange>,
  currentDatasource: string,
  currentRegistryUrl: string | undefined,
): void {
  if (!line.startsWith("-") || line.startsWith("---")) {
    return;
  }
  const parsed = parseVersionLine(line);
  if (parsed === undefined) {
    return;
  }
  const existing = changes.get(parsed.name);
  if (existing !== undefined) {
    return;
  }
  changes.set(parsed.name, {
    name: parsed.name,
    datasource: currentDatasource,
    registryUrl: currentRegistryUrl,
    oldVersion: parsed.version,
    newVersion: parsed.version,
  });
}

function handleAddedLine(
  line: string,
  changes: Map<string, DependencyChange>,
  currentDatasource: string,
  currentRegistryUrl: string | undefined,
): void {
  if (!line.startsWith("+") || line.startsWith("+++")) {
    return;
  }
  const parsed = parseVersionLine(line);
  if (parsed === undefined) {
    return;
  }
  const existing = changes.get(parsed.name);
  if (existing === undefined) {
    changes.set(parsed.name, {
      name: parsed.name,
      datasource: currentDatasource,
      registryUrl: currentRegistryUrl,
      oldVersion: parsed.version,
      newVersion: parsed.version,
    });
  } else {
    existing.newVersion = parsed.version;
  }
}

export type DependencyChange = {
  name: string;
  datasource: string;
  registryUrl: string | undefined;
  oldVersion: string;
  newVersion: string;
};

export type ReleaseNote = {
  dependency: string;
  source: string;
  version: string;
  notes: string;
  url: string | undefined;
};

export type FailedFetch = {
  dependency: string;
  reason: string;
};

export type ReleaseNotesResult = {
  notes: ReleaseNote[];
  failed: FailedFetch[];
};

const GithubRelease = z.object({
  body: z.string().optional(),
  html_url: z.string().optional(),
});

async function tryFetchReleaseNote(
  repo: string,
  version: string,
  headers: Record<string, string>,
): Promise<ReleaseNote | undefined> {
  const tagVariants = [
    `v${version}`,
    version,
    `${repo.split("/").pop() ?? ""}-${version}`,
  ];

  for (const tag of tagVariants) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/releases/tags/${tag}`,
      { headers },
    );
    if (!response.ok) {
      continue;
    }
    const release = GithubRelease.parse(await response.json());
    if (release.body !== undefined && release.body.length > 50) {
      return {
        dependency: repo,
        source: "github",
        version,
        notes: release.body,
        url: release.html_url,
      };
    }
  }

  return undefined;
}

export type DepsSummaryActivities = typeof depsSummaryActivities;

export const depsSummaryActivities = {
  async cloneAndGetVersionChanges(
    daysBack: number,
  ): Promise<DependencyChange[]> {
    const id = crypto.randomUUID();
    const tempDir = `/tmp/homelab-dep-summary-${id}`;

    try {
      const since = new Date();
      since.setDate(since.getDate() - daysBack);
      const sinceStr = since.toISOString().split("T")[0] ?? "";

      const git = simpleGit();
      await git.clone(REPO_URL, tempDir, [
        `--shallow-since=${sinceStr}`,
        "--no-single-branch",
      ]);

      const repoGit = simpleGit(tempDir);

      const log = await repoGit.log({
        "--since": sinceStr,
        "--": [VERSIONS_FILE_PATH],
      });

      const changes = new Map<string, DependencyChange>();
      const renovateCommentRegex =
        /\/\/ renovate: datasource=(\S+)(?:\s+registryUrl=(\S+))?/;

      for (const commit of log.all) {
        let diff: string;
        try {
          diff = await repoGit.diff([
            `${commit.hash}^`,
            commit.hash,
            "--unified=0",
            "--",
            VERSIONS_FILE_PATH,
          ]);
        } catch {
          // Parent is outside the shallow-since history (graft boundary) — skip.
          continue;
        }

        let currentDatasource = "";
        let currentRegistryUrl: string | undefined;

        for (const line of diff.split("\n")) {
          const commentMatch = renovateCommentRegex.exec(line);
          if (commentMatch !== null) {
            currentDatasource = commentMatch[1] ?? "";
            currentRegistryUrl = commentMatch[2];
            continue;
          }

          handleRemovedLine(
            line,
            changes,
            currentDatasource,
            currentRegistryUrl,
          );
          handleAddedLine(line, changes, currentDatasource, currentRegistryUrl);
        }
      }

      // Filter: only include where versions actually changed
      return [...changes.values()].filter((c) => c.oldVersion !== c.newVersion);
    } finally {
      // Clean up temp directory
      await Bun.$`rm -rf ${tempDir}`.quiet();
    }
  },

  async fetchReleaseNotes(
    changes: DependencyChange[],
  ): Promise<ReleaseNotesResult> {
    const ghToken = Bun.env["GH_TOKEN"] ?? "";
    const notes: ReleaseNote[] = [];
    const failed: FailedFetch[] = [];
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
    };
    if (ghToken !== "") {
      headers["Authorization"] = `Bearer ${ghToken}`;
    }

    for (const change of changes) {
      if (
        change.datasource !== "github-releases" &&
        change.datasource !== "docker" &&
        change.datasource !== "helm"
      ) {
        continue;
      }

      try {
        const note = await tryFetchReleaseNote(
          change.name,
          change.newVersion,
          headers,
        );
        if (note === undefined) {
          failed.push({
            dependency: change.name,
            reason: "No release notes found for any tag variant",
          });
        } else {
          notes.push(note);
        }
      } catch (error) {
        failed.push({
          dependency: change.name,
          reason: String(error),
        });
      }
    }

    return { notes, failed };
  },

  async summarizeWithLLM(
    changes: DependencyChange[],
    releaseNotes: ReleaseNote[],
  ): Promise<string> {
    const apiKey = Bun.env["OPENAI_API_KEY"];
    if (apiKey === undefined || apiKey === "") {
      console.warn("OPENAI_API_KEY not set, skipping LLM summarization");
      return "LLM summarization skipped - API key not configured";
    }

    const openai = new OpenAI({ apiKey });

    const changesText = changes
      .map(
        (c) =>
          `- ${c.name}: ${c.oldVersion} → ${c.newVersion} (${c.datasource})`,
      )
      .join("\n");

    const notesText = releaseNotes
      .map(
        (n) =>
          `## ${n.dependency} [${n.source}] (${n.version})\n${n.notes}\n${n.url === undefined ? "" : `URL: ${n.url}`}`,
      )
      .join("\n\n");

    const fetchedDeps = new Set(
      releaseNotes.map((n) =>
        n.dependency.replace(/ \((?:helm chart|app)\)$/, ""),
      ),
    );
    const missingNotes = changes
      .filter((c) => !fetchedDeps.has(c.name))
      .map((c) => c.name);
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
        max_completion_tokens: 8000,
      });

      const choice = completion.choices[0];
      return choice?.message.content ?? "Failed to generate summary";
    } catch (error) {
      console.error(`OpenAI API error: ${String(error)}`);
      return "Failed to generate LLM summary";
    }
  },

  async formatAndSendEmail(
    changes: DependencyChange[],
    summary: string,
    failedFetches: FailedFetch[],
  ): Promise<void> {
    const postalHost = Bun.env["POSTAL_HOST"];
    const postalApiKey = Bun.env["POSTAL_API_KEY"];
    const recipientEmail = Bun.env["RECIPIENT_EMAIL"];
    const senderEmail = Bun.env["SENDER_EMAIL"] ?? "updates@homelab.local";

    if (
      postalHost === undefined ||
      postalApiKey === undefined ||
      recipientEmail === undefined
    ) {
      throw new Error(
        "Missing email configuration: POSTAL_HOST, POSTAL_API_KEY, RECIPIENT_EMAIL",
      );
    }

    const subject =
      changes.length === 0
        ? "No Dependency Updates This Week"
        : `Weekly Dependency Summary: ${String(changes.length)} updates`;

    let html = `<h1>Weekly Dependency Summary</h1>`;
    html += `<p>Generated: ${new Date().toISOString()}</p>`;

    if (changes.length > 0) {
      html += `<h2>Dependencies Updated</h2><table><tr><th>Name</th><th>Old</th><th>New</th><th>Source</th></tr>`;
      for (const c of changes) {
        html += `<tr><td>${c.name}</td><td>${c.oldVersion}</td><td>${c.newVersion}</td><td>${c.datasource}</td></tr>`;
      }
      html += `</table>`;

      if (summary !== "") {
        html += `<h2>AI Summary</h2>${summary}`;
      }

      if (failedFetches.length > 0) {
        html += `<h2>Failed Release Note Fetches</h2><ul>`;
        for (const f of failedFetches) {
          html += `<li>${f.dependency}: ${f.reason}</li>`;
        }
        html += `</ul>`;
      }
    } else {
      html += `<p>No dependencies were updated this week.</p>`;
    }

    const postalHostHeader = Bun.env["POSTAL_HOST_HEADER"];
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Server-API-Key": postalApiKey,
    };
    if (postalHostHeader !== undefined) {
      headers["Host"] = postalHostHeader;
    }

    const response = await fetch(`${postalHost}/api/v1/send/message`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: [recipientEmail],
        from: senderEmail,
        subject,
        html_body: html,
        tag: "dependency-summary",
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Postal API error (${String(response.status)}): ${body}`);
    }

    console.warn(`Email sent: ${subject}`);
  },
};
