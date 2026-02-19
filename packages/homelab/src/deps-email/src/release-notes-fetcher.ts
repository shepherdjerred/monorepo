import { OpenAI } from "openai";
import { z } from "zod";
import type { ReleaseNote } from "./types.ts";
import { IMAGE_TO_GITHUB } from "./image-github-mapping.ts";
import {
  isVersionInRange,
  isVersionLessThanOrEqual,
  compareVersions,
} from "./version-compare.ts";

// Zod schemas for API responses
const ArtifactHubChangeSchema = z.object({
  version: z.string(),
  changes: z.string(),
});

const ArtifactHubResponseSchema = z.object({
  version: z.string().optional(),
  changes: z.array(ArtifactHubChangeSchema).optional(),
  repository: z
    .object({
      url: z.string().optional(),
    })
    .optional(),
});

const GitHubReleaseSchema = z.object({
  tag_name: z.string().optional(),
  body: z.string().optional(),
  html_url: z.string().optional(),
  published_at: z.string().optional(),
});

const GitHubCompareResponseSchema = z.object({
  commits: z
    .array(
      z.object({
        commit: z
          .object({
            message: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

/**
 * Fetch all release notes between two versions
 *
 * Uses multiple sources with fallback:
 * 1. GitHub Releases (preferred)
 * 2. ArtifactHub (for Helm charts)
 * 3. CHANGELOG.md
 * 4. Git tag comparison + LLM extraction
 */
type ReleaseNoteFetcher = () => Promise<ReleaseNote[]>;

export async function fetchReleaseNotesBetween(
  repo: string,
  oldVersion: string,
  newVersion: string,
): Promise<ReleaseNote[]> {
  // Try sources in order of preference
  const sources: ReleaseNoteFetcher[] = [
    () => fetchFromGitHubReleases(repo, oldVersion, newVersion),
    () => fetchFromChangelog(repo, oldVersion, newVersion),
    () => fetchFromGitCompare(repo, oldVersion, newVersion),
  ];

  for (const source of sources) {
    try {
      const notes = await source();
      if (notes.length > 0) {
        return notes;
      }
    } catch (error) {
      console.warn(`Release notes source failed for ${repo}: ${String(error)}`);
    }
  }

  return [];
}

/**
 * Fetch release notes for a Helm chart from ArtifactHub
 */
export async function fetchFromArtifactHub(
  chartName: string,
  repoName: string,
  oldVersion: string,
  newVersion: string,
): Promise<ReleaseNote[]> {
  try {
    const url = `https://artifacthub.io/api/v1/packages/helm/${repoName}/${chartName}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "homelab-dependency-summary" },
    });

    if (!response.ok) {
      return [];
    }

    const rawData: unknown = await response.json();
    const parsed = ArtifactHubResponseSchema.safeParse(rawData);

    if (!parsed.success) {
      return [];
    }

    // ArtifactHub may have a changes array
    if (parsed.data.changes) {
      const notes: ReleaseNote[] = [];

      for (const change of parsed.data.changes) {
        if (isVersionInRange(change.version, oldVersion, newVersion)) {
          notes.push({
            version: change.version,
            body: change.changes,
            source: "artifacthub",
          });
        }
      }

      return notes;
    }

    return [];
  } catch {
    return [];
  }
}

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "homelab-dependency-summary",
  };

  const token = Bun.env["GITHUB_TOKEN"];
  if (token != null && token !== "") {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

/**
 * Fetch all releases in a version range from GitHub Releases
 */
async function fetchFromGitHubReleases(
  repo: string,
  oldVersion: string,
  newVersion: string,
): Promise<ReleaseNote[]> {
  const [owner, repoName] = repo.split("/");
  if ((owner == null || owner === "") || (repoName == null || repoName === "")) {
    return [];
  }

  const headers = getGitHubHeaders();
  const notes: ReleaseNote[] = [];

  // Fetch releases (paginated)
  let page = 1;
  let hasMore = true;

  while (hasMore && page <= 10) {
    // Limit to 10 pages
    const url = `https://api.github.com/repos/${owner}/${repoName}/releases?per_page=100&page=${String(page)}`;

    try {
      const response = await fetch(url, { headers });

      if (!response.ok) {
        break;
      }

      const rawData: unknown = await response.json();
      const parsed = z.array(GitHubReleaseSchema).safeParse(rawData);

      if (!parsed.success || parsed.data.length === 0) {
        hasMore = false;
        break;
      }

      for (const release of parsed.data) {
        const tag = release.tag_name;
        if ((tag == null || tag === "")) {
          continue;
        }

        // Check if this version is in range
        if (
          isVersionInRange(tag, oldVersion, newVersion) &&
          release.body != null && release.body !== "" &&
          release.body.length > 10
        ) {
          notes.push({
            version: tag,
            body: release.body,
            url: release.html_url,
            source: "github-releases",
            publishedAt: release.published_at,
          });
        }

        // If we've gone past the old version, stop
        if (isVersionLessThanOrEqual(tag, oldVersion)) {
          hasMore = false;
          break;
        }
      }

      page++;
    } catch {
      break;
    }
  }

  // Sort by version (newest first)
  notes.sort((a, b) => compareVersions(b.version, a.version));

  return notes;
}

async function fetchFromChangelog(
  repo: string,
  oldVersion: string,
  newVersion: string,
): Promise<ReleaseNote[]> {
  const [owner, repoName] = repo.split("/");
  if ((owner == null || owner === "") || (repoName == null || repoName === "")) {
    return [];
  }

  // Try different changelog filenames and branches
  const filenames = [
    "CHANGELOG.md",
    "CHANGELOG",
    "CHANGES.md",
    "HISTORY.md",
    "NEWS.md",
  ];
  const branches = ["main", "master"];

  for (const branch of branches) {
    for (const filename of filenames) {
      try {
        const url = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${filename}`;
        const response = await fetch(url);

        if (!response.ok) {
          continue;
        }
        const content = await response.text();
        const notes = parseChangelog(content, oldVersion, newVersion);

        if (notes.length > 0) {
          return notes;
        }
      } catch {
        continue;
      }
    }
  }

  return [];
}

/**
 * Parse a CHANGELOG file to extract version entries
 */
function parseChangelog(
  content: string,
  oldVersion: string,
  newVersion: string,
): ReleaseNote[] {
  const notes: ReleaseNote[] = [];

  // Common changelog header patterns
  const headerPatterns = [
    /^##\s*\[?v?([\d.]+(?:-[\w.]+)?)\]?\s*(?:-\s*|\()?/gm, // ## [1.2.3] or ## v1.2.3 - date
    /^#\s*v?([\d.]+(?:-[\w.]+)?)/gm, // # 1.2.3
    /^###\s*v?([\d.]+(?:-[\w.]+)?)/gm, // ### 1.2.3
  ];

  // Find all version headers and their positions
  type VersionPosition = { version: string; start: number };
  const versionPositions: VersionPosition[] = [];

  for (const pattern of headerPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const version = match[1];
      if (version != null && version !== "") {
        versionPositions.push({
          version: version,
          start: match.index,
        });
      }
    }
  }

  // Sort by position
  versionPositions.sort((a, b) => a.start - b.start);

  // Extract content between version headers
  for (let i = 0; i < versionPositions.length; i++) {
    const current = versionPositions[i];
    if (!current) {
      continue;
    }

    const next = versionPositions[i + 1];
    const end = next ? next.start : content.length;

    const version = current.version;

    // Check if this version is in range
    if (isVersionInRange(version, oldVersion, newVersion)) {
      // Extract the section content
      const sectionContent = content.slice(current.start, end).trim();

      // Remove the header line
      const bodyStart = sectionContent.indexOf("\n");
      const body =
        bodyStart === -1 ? "" : sectionContent.slice(bodyStart + 1).trim();

      if (body.length > 10) {
        notes.push({
          version: `v${version}`,
          body: body,
          source: "changelog",
        });
      }
    }
  }

  return notes;
}

async function fetchFromGitCompare(
  repo: string,
  oldVersion: string,
  newVersion: string,
): Promise<ReleaseNote[]> {
  const [owner, repoName] = repo.split("/");
  if ((owner == null || owner === "") || (repoName == null || repoName === "")) {
    return [];
  }

  const headers = getGitHubHeaders();

  // Try different tag formats
  const tagFormats = [
    (v: string) => v,
    (v: string) => v.replace(/^v/, ""),
    (v: string) => (v.startsWith("v") ? v : `v${v}`),
  ];

  for (const formatOld of tagFormats) {
    for (const formatNew of tagFormats) {
      const oldTag = formatOld(oldVersion);
      const newTag = formatNew(newVersion);

      try {
        const url = `https://api.github.com/repos/${owner}/${repoName}/compare/${oldTag}...${newTag}`;
        const response = await fetch(url, { headers });

        if (!response.ok) {
          continue;
        }

        const rawData: unknown = await response.json();
        const parsed = GitHubCompareResponseSchema.safeParse(rawData);

        if (
          !parsed.success ||
          !parsed.data.commits ||
          parsed.data.commits.length === 0
        ) {
          continue;
        }

        // Extract commit messages
        const messages = parsed.data.commits
          .map((c) => z.string().safeParse(c.commit?.message))
          .filter((result) => result.success)
          .map((result) => result.data);
        const commitMessages = messages.join("\n---\n");

        // Use LLM to extract meaningful release notes from commits
        const extracted = await extractWithLLM(
          commitMessages,
          oldVersion,
          newVersion,
        );

        if (extracted.length > 0) {
          return extracted;
        }
      } catch {
        continue;
      }
    }
  }

  return [];
}

/**
 * Use LLM to extract release notes from unstructured content
 */
async function extractWithLLM(
  content: string,
  oldVersion: string,
  newVersion: string,
): Promise<ReleaseNote[]> {
  const apiKey = Bun.env["OPENAI_API_KEY"];
  if ((apiKey == null || apiKey === "")) {
    // Return raw commits as fallback
    return [
      {
        version: newVersion,
        body: content.slice(0, 5000), // Limit size
        source: "git-compare",
      },
    ];
  }

  try {
    const openai = new OpenAI({ apiKey });

    const prompt = `Extract release notes from the following commit messages between versions ${oldVersion} and ${newVersion}.

Summarize the changes into these categories (only include categories that have changes):
- **Breaking Changes**: Changes that may break existing functionality
- **New Features**: New functionality added
- **Bug Fixes**: Bugs that were fixed
- **Security**: Security-related changes
- **Performance**: Performance improvements
- **Other**: Other notable changes

Be concise but informative. Focus on user-facing changes.

Commit messages:
${content.slice(0, 10_000)}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
      temperature: 0.3,
    });

    const choice = response.choices[0];
    const body = choice?.message.content;
    if (body != null && body !== "" && body.length > 20) {
      return [
        {
          version: newVersion,
          body: body,
          source: "llm-extracted",
        },
      ];
    }
  } catch (error) {
    console.warn(`LLM extraction failed: ${String(error)}`);
  }

  return [];
}

/**
 * Map an image repository to its GitHub repository
 */
export function getGitHubRepoForImage(imageRepo: string): string | null {
  // Check direct mapping
  if (IMAGE_TO_GITHUB[imageRepo] != null && IMAGE_TO_GITHUB[imageRepo] !== "") {
    return IMAGE_TO_GITHUB[imageRepo];
  }

  // Try without registry prefix
  const withoutRegistry = imageRepo.replace(/^[^/]+\.io\//, "");
  if (IMAGE_TO_GITHUB[withoutRegistry] != null && IMAGE_TO_GITHUB[withoutRegistry] !== "") {
    return IMAGE_TO_GITHUB[withoutRegistry];
  }

  // Assume org/repo format maps directly to GitHub
  if (imageRepo.includes("/") && !imageRepo.includes(".")) {
    return imageRepo;
  }

  return null;
}
