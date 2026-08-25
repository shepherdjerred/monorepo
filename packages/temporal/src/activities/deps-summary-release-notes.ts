import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import type { DependencyChange } from "#shared/deps-summary-types.ts";
import { ociManifestAttempt } from "./deps-summary-oci.ts";
import { dependencyNoteText } from "./deps-summary-text.ts";
import { generateBoundedSynthesis } from "./openrouter-runtime.ts";

const REPO_SLUG = "shepherdjerred/monorepo";

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Unit tests call collectors outside an activity context.
  }
}

function yamlScalar(text: string, key: string): string | undefined {
  const prefix = `${key}:`;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim();
      return value === "" ? undefined : value;
    }
  }
  return undefined;
}

const PullSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
  body: z.string().nullable(),
  title: z.string().min(1),
  merged_at: z.string().nullable(),
});
const PullsSchema = z.array(PullSchema);
const GithubReleaseSchema = z.object({
  body: z.string().nullable().optional(),
  html_url: z.url().optional(),
});
export type ReleaseNoteAttempt = {
  source:
    | "merged-pr"
    | "github-release"
    | "helm-index"
    | "oci-manifest"
    | "catalog-override";
  url: string | undefined;
  outcome: "found" | "unavailable" | "failed";
  detail: string;
};

export type ReleaseNote = {
  dependency: string;
  version: string;
  notes: string;
  url: string | undefined;
  source: ReleaseNoteAttempt["source"];
};

export type MissingReleaseNote = {
  dependency: string;
  commitSha: string;
  attempts: ReleaseNoteAttempt[];
};

export type ReleaseNotesResult = {
  notes: ReleaseNote[];
  missing: MissingReleaseNote[];
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

async function mergedPrAttempt(
  change: DependencyChange,
  headers: Record<string, string>,
): Promise<{ attempt: ReleaseNoteAttempt; note: ReleaseNote | undefined }> {
  const url = `https://api.github.com/repos/${REPO_SLUG}/commits/${change.commitSha}/pulls`;
  try {
    const response = await fetchWithTimeout(url, { headers });
    if (!response.ok) {
      return {
        attempt: {
          source: "merged-pr",
          url,
          outcome: "failed",
          detail: `GitHub returned HTTP ${String(response.status)}`,
        },
        note: undefined,
      };
    }
    const pull = PullsSchema.parse(await response.json()).find(
      (candidate) => candidate.merged_at !== null,
    );
    const notes = dependencyNoteText(pull?.body);
    if (pull === undefined || notes === undefined) {
      return {
        attempt: {
          source: "merged-pr",
          url: pull?.html_url ?? url,
          outcome: "unavailable",
          detail: "Associated merged PR has no substantive body",
        },
        note: undefined,
      };
    }
    return {
      attempt: {
        source: "merged-pr",
        url: pull.html_url,
        outcome: "found",
        detail: `PR #${pull.number.toString()}: ${pull.title}`,
      },
      note: {
        dependency: change.name,
        version: change.newVersion ?? "removed",
        notes,
        url: pull.html_url,
        source: "merged-pr",
      },
    };
  } catch (error) {
    return {
      attempt: {
        source: "merged-pr",
        url,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      note: undefined,
    };
  }
}

async function githubReleaseAttempt(
  change: DependencyChange,
  headers: Record<string, string>,
): Promise<{ attempt: ReleaseNoteAttempt; note: ReleaseNote | undefined }> {
  const repository = change.packageName ?? change.name;
  const version = change.newVersion;
  if (version === undefined || repository.split("/").length !== 2) {
    return {
      attempt: {
        source: "github-release",
        url: undefined,
        outcome: "unavailable",
        detail: "No owner/repository and version pair is available",
      },
      note: undefined,
    };
  }
  const tags = [
    version,
    version.startsWith("v") ? version.slice(1) : `v${version}`,
  ];
  for (const tag of tags) {
    const url = `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`;
    try {
      const response = await fetchWithTimeout(url, { headers });
      if (!response.ok) continue;
      const release = GithubReleaseSchema.parse(await response.json());
      const notes = dependencyNoteText(release.body);
      if (notes !== undefined) {
        return {
          attempt: {
            source: "github-release",
            url: release.html_url ?? url,
            outcome: "found",
            detail: `Found release ${tag}`,
          },
          note: {
            dependency: change.name,
            version,
            notes,
            url: release.html_url,
            source: "github-release",
          },
        };
      }
    } catch (error) {
      return {
        attempt: {
          source: "github-release",
          url,
          outcome: "failed",
          detail: error instanceof Error ? error.message : String(error),
        },
        note: undefined,
      };
    }
  }
  return {
    attempt: {
      source: "github-release",
      url: `https://github.com/${repository}/releases`,
      outcome: "unavailable",
      detail: `No substantive release body found for ${version}`,
    },
    note: undefined,
  };
}

async function helmIndexAttempt(
  change: DependencyChange,
): Promise<{ attempt: ReleaseNoteAttempt; note: ReleaseNote | undefined }> {
  const base = change.registryUrl;
  const version = change.newVersion;
  const url =
    base === undefined ? undefined : `${base.replace(/\/$/, "")}/index.yaml`;
  if (url === undefined || version === undefined) {
    return {
      attempt: {
        source: "helm-index",
        url,
        outcome: "unavailable",
        detail: "Chart repository URL or version is missing",
      },
      note: undefined,
    };
  }
  try {
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      return {
        attempt: {
          source: "helm-index",
          url,
          outcome: "failed",
          detail: `Chart index returned HTTP ${String(response.status)}`,
        },
        note: undefined,
      };
    }
    const index = await response.text();
    const versionIndex = index.indexOf(`version: ${version}`);
    const excerpt =
      versionIndex === -1
        ? ""
        : index.slice(Math.max(0, versionIndex - 2000), versionIndex + 1000);
    const description = yamlScalar(excerpt, "description");
    const home = yamlScalar(excerpt, "home");
    const notes = dependencyNoteText(description);
    return notes === undefined
      ? {
          attempt: {
            source: "helm-index",
            url,
            outcome: "unavailable",
            detail:
              "Chart index was readable but contained no narrative release notes",
          },
          note: undefined,
        }
      : {
          attempt: {
            source: "helm-index",
            url: home ?? url,
            outcome: "found",
            detail: "Found chart description metadata",
          },
          note: {
            dependency: change.name,
            version,
            notes,
            url: home ?? url,
            source: "helm-index",
          },
        };
  } catch (error) {
    return {
      attempt: {
        source: "helm-index",
        url,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      note: undefined,
    };
  }
}

function overrideAttempt(change: DependencyChange): {
  attempt: ReleaseNoteAttempt;
  note: ReleaseNote | undefined;
} {
  const override = change.releaseNotesOverride;
  return override === undefined
    ? {
        attempt: {
          source: "catalog-override",
          url: undefined,
          outcome: "unavailable",
          detail: "No catalog release-note override is declared",
        },
        note: undefined,
      }
    : {
        attempt: {
          source: "catalog-override",
          url: override.url,
          outcome: "found",
          detail: "Used explicit catalog release-note override",
        },
        note: {
          dependency: change.name,
          version: change.newVersion ?? "removed",
          notes: override.summary,
          url: override.url,
          source: "catalog-override",
        },
      };
}

export async function fetchDependencyReleaseNotes(
  changes: DependencyChange[],
): Promise<ReleaseNotesResult> {
  if (changes.length === 0) return { notes: [], missing: [] };
  const { token } = await createGitHubAppInstallationToken();
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const notes: ReleaseNote[] = [];
  const missing: MissingReleaseNote[] = [];
  for (const [index, change] of changes.entries()) {
    safeHeartbeat({ phase: "release-notes", dependency: change.name, index });
    const attempts: ReleaseNoteAttempt[] = [];
    const pr = await mergedPrAttempt(change, headers);
    attempts.push(pr.attempt);
    let note = pr.note;
    if (note === undefined && change.newValue !== undefined) {
      const datasourceResult =
        change.datasource === "github-releases"
          ? await githubReleaseAttempt(change, headers)
          : change.artifactType === "helm-chart" && change.datasource === "helm"
            ? await helmIndexAttempt(change)
            : change.artifactType === "image" ||
                (change.artifactType === "helm-chart" &&
                  change.datasource === "docker")
              ? await ociManifestAttempt(change)
              : undefined;
      if (datasourceResult !== undefined) {
        attempts.push(datasourceResult.attempt);
        note = datasourceResult.note;
      }
    }
    if (note === undefined) {
      const override = overrideAttempt(change);
      attempts.push(override.attempt);
      note = override.note;
    }
    if (note === undefined) {
      missing.push({
        dependency: change.name,
        commitSha: change.commitSha,
        attempts,
      });
    } else {
      notes.push(note);
    }
  }
  return { notes, missing };
}

export async function synthesizeDependencyChanges(
  changes: DependencyChange[],
  notes: ReleaseNote[],
): Promise<string | undefined> {
  if (notes.length === 0) {
    return undefined;
  }
  return await generateBoundedSynthesis({
    callSite: "deps-summary",
    workload: "deps-summary-synthesis",
    maxWords: 80,
    prompt: [
      "Write at most 80 words summarizing only the supplied dependency evidence. No headings, boilerplate, or speculation.",
      JSON.stringify({ changes, notes }),
    ].join("\n"),
  });
}
