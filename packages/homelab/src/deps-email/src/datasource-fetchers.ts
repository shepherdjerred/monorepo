import {
  fetchReleaseNotesBetween,
  getGitHubRepoForImage,
} from "./release-notes-fetcher.ts";
import {
  HELM_CHART_GITHUB_REPOS,
  HELM_CHART_APP_REPOS,
  DOCKER_IMAGE_GITHUB_REPOS,
} from "./repo-mappings.ts";
import {
  ArtifactHubSchema,
  type DependencyInfo,
  type ReleaseNotes,
} from "./main-schemas.ts";
import type { FullDependencyDiff } from "./types.ts";
import { getFullDependencyChanges } from "./version-differ.ts";
import { fetchGitHubReleases } from "./github-releases.ts";

export async function tryArtifactHubFallback(
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
    if ((repoUrl == null || repoUrl === "")) {
      return null;
    }

    const repoMatch = /github\.com\/([^/]+\/[^/]+)/i.exec(repoUrl);
    if (repoMatch?.[1] == null || repoMatch[1] === "") {
      return null;
    }

    const [owner, repo] = repoMatch[1].split("/");
    if ((owner == null || owner === "") || (repo == null || repo === "")) {
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

export async function fetchDockerReleaseNotes(
  dep: DependencyInfo,
): Promise<ReleaseNotes | null> {
  // Look up the GitHub repo for this Docker image
  const githubRepo = DOCKER_IMAGE_GITHUB_REPOS[dep.name];

  // Build list of repos to try (mapped repo first, then fallback patterns)
  const reposToTry: string[] = [];

  if (githubRepo != null && githubRepo !== "") {
    reposToTry.push(githubRepo);
  }

  // Try common GitHub repo patterns as fallback
  const [org, image] = dep.name.split("/");
  if (org != null && org !== "" && image != null && image !== "") {
    reposToTry.push(
      `${org}/${image}`,
      `${org}/docker-${image}`,
      `${image}/${image}`, // e.g., syncthing/syncthing
    );
  }

  // Use the full fallback chain (GitHub Releases, CHANGELOG.md, Git Compare + LLM)
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

export async function fetchChartReleaseNotes(dep: DependencyInfo): Promise<ReleaseNotes | null> {
  const chartRepo = HELM_CHART_GITHUB_REPOS[dep.name];
  if (chartRepo == null || chartRepo === "") {
    return null;
  }
  const [owner, repo] = chartRepo.split("/");
  if (owner == null || owner === "" || repo == null || repo === "") {
    return null;
  }

  const chartTags = [
    `${dep.name}-${dep.newVersion}`,
    dep.newVersion,
    `v${dep.newVersion}`,
  ];

  for (const tag of chartTags) {
    const releases = await fetchGitHubReleases(owner, repo, tag);
    if (releases) {
      return {
        dependency: `${dep.name} (helm chart)`,
        version: dep.newVersion,
        notes: releases.body,
        url: releases.url,
        source: "helm-chart",
      };
    }
  }
  return null;
}

export async function fetchAppReleaseNotes(dep: DependencyInfo): Promise<ReleaseNotes | null> {
  const chartRepo = HELM_CHART_GITHUB_REPOS[dep.name];
  const appRepo = HELM_CHART_APP_REPOS[dep.name];
  if (appRepo == null || appRepo === "" || appRepo === chartRepo) {
    return null;
  }
  const [owner, repo] = appRepo.split("/");
  if (owner == null || owner === "" || repo == null || repo === "") {
    return null;
  }

  const releases = await fetchGitHubReleases(owner, repo, dep.newVersion);
  if (releases) {
    return {
      dependency: `${dep.name} (app)`,
      version: dep.newVersion,
      notes: releases.body,
      url: releases.url,
      source: "app",
    };
  }
  return null;
}

export async function fetchTransitiveReleaseNotes(
  dep: DependencyInfo,
  transitiveDepsDiffs: Map<string, FullDependencyDiff>,
): Promise<ReleaseNotes[]> {
  if (dep.registryUrl == null || dep.registryUrl === "") {
    return [];
  }

  const results: ReleaseNotes[] = [];
  try {
    console.log(`  Fetching transitive dependencies for ${dep.name}...`);
    const transitiveDiff = await getFullDependencyChanges({
      chartName: dep.name,
      registryUrl: dep.registryUrl,
      oldVersion: dep.oldVersion,
      newVersion: dep.newVersion,
    });

    transitiveDepsDiffs.set(dep.name, transitiveDiff);

    for (const imageUpdate of transitiveDiff.images.updated) {
      const githubRepo = getGitHubRepoForImage(imageUpdate.repository);
      if (githubRepo == null || githubRepo === "") {
        continue;
      }
      console.log(
        `    Fetching release notes for ${imageUpdate.repository} (${imageUpdate.oldTag} -> ${imageUpdate.newTag})...`,
      );
      const notes = await fetchReleaseNotesBetween(githubRepo, imageUpdate.oldTag, imageUpdate.newTag);
      for (const note of notes) {
        results.push({
          dependency: `${dep.name} -> ${imageUpdate.repository}`,
          version: note.version,
          notes: note.body,
          url: note.url,
          source: "app",
        });
      }
    }

    for (const chartUpdate of transitiveDiff.charts.updated) {
      const subChartRepo = HELM_CHART_GITHUB_REPOS[chartUpdate.name] ?? HELM_CHART_APP_REPOS[chartUpdate.name];
      if (subChartRepo == null || subChartRepo === "") {
        continue;
      }
      console.log(
        `    Fetching release notes for sub-chart ${chartUpdate.name} (${chartUpdate.oldVersion} -> ${chartUpdate.newVersion})...`,
      );
      const notes = await fetchReleaseNotesBetween(subChartRepo, chartUpdate.oldVersion, chartUpdate.newVersion);
      for (const note of notes) {
        results.push({
          dependency: `${dep.name} -> ${chartUpdate.name}`,
          version: note.version,
          notes: note.body,
          url: note.url,
          source: "helm-chart",
        });
      }
    }

    console.log(
      `  Found ${String(transitiveDiff.images.updated.length)} image updates, ${String(transitiveDiff.charts.updated.length)} sub-chart updates`,
    );
  } catch (error) {
    console.warn(`  Failed to fetch transitive deps for ${dep.name}: ${String(error)}`);
  }

  return results;
}

export async function fetchHelmReleaseNotes(
  dep: DependencyInfo,
  transitiveDepsDiffs: Map<string, FullDependencyDiff>,
): Promise<ReleaseNotes[]> {
  const results: ReleaseNotes[] = [];

  const chartResult = await fetchChartReleaseNotes(dep);
  if (chartResult) {
    results.push(chartResult);
  }

  const appResult = await fetchAppReleaseNotes(dep);
  if (appResult) {
    results.push(appResult);
  }

  if (results.length === 0) {
    const artifactHubResult = await tryArtifactHubFallback(dep.name, dep.newVersion);
    if (artifactHubResult) {
      results.push(artifactHubResult);
    }
  }

  const transitiveResults = await fetchTransitiveReleaseNotes(dep, transitiveDepsDiffs);
  results.push(...transitiveResults);

  return results;
}
