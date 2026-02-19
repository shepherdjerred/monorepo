import {
  GitHubReleaseSchema,
  GitHubReleasesArraySchema,
} from "./main-schemas.ts";

export function getGitHubHeaders(): Record<string, string> {
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

export async function fetchGitHubReleases(
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
          parsed.data.body != null && parsed.data.body !== "" &&
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
            r.tag_name?.includes(version) === true ||
            r.tag_name?.includes(version.replace(/^v/, "")) === true,
        );

        if (matchingRelease?.body != null && matchingRelease.body !== "" && matchingRelease.body.length > 50) {
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
