import { createHash } from "node:crypto";
import { zstdCompressSync } from "node:zlib";
import { z } from "zod/v4";
import {
  isExcludedRepository,
  type DiscoveredGitRepository,
  type GitBackupConfig,
} from "./git-backup-report.ts";
import { redactGitSecrets, type GitSubprocessHooks } from "./git-backup-git.ts";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_PAGE_SIZE = 100;
const GITHUB_TIMEOUT_MS = 30_000;

export type GitHubApiFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

const GitHubRepoSchema = z.object({
  name: z.string().min(1),
  full_name: z.string().min(1),
  clone_url: z.string().min(1),
  has_wiki: z.boolean().default(false),
  has_issues: z.boolean().default(true),
  archived: z.boolean().default(false),
  fork: z.boolean().default(false),
  owner: z.object({
    login: z.string().min(1),
  }),
});

const GitHubIssueSchema = z.looseObject({
  id: z.number(),
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
});

const GitHubIssueCommentSchema = z.looseObject({
  id: z.number(),
  issue_url: z.string(),
  body: z.string().nullable().optional(),
});

function parseNextLinkHeader(linkHeader: string | null): string | undefined {
  if (linkHeader === null || linkHeader === "") {
    return undefined;
  }
  for (const segment of linkHeader.split(",")) {
    const parts = segment.split(";").map((part) => part.trim());
    const urlPart = parts[0];
    const isNext = parts.slice(1).includes('rel="next"');
    if (
      isNext &&
      urlPart !== undefined &&
      urlPart.startsWith("<") &&
      urlPart.endsWith(">")
    ) {
      return urlPart.slice(1, -1);
    }
  }
  return undefined;
}

async function fetchPaginatedGitHubArray<T extends z.ZodType>(input: {
  readonly initialPath: string;
  readonly itemSchema: T;
  readonly fetchImpl: GitHubApiFetch;
  readonly token: string;
  readonly secrets: readonly string[];
  readonly hooks: GitSubprocessHooks;
  readonly stepLabel: string;
}): Promise<z.infer<T>[]> {
  const items: z.infer<T>[] = [];
  const PageArraySchema = z.array(input.itemSchema);
  let nextUrl: string | undefined = `${GITHUB_API_BASE}${input.initialPath}`;
  let page = 0;

  while (nextUrl !== undefined) {
    if (input.hooks.cancellationSignal?.aborted === true) {
      input.hooks.cancellationSignal.throwIfAborted();
    }
    page += 1;
    input.hooks.heartbeat({ step: input.stepLabel, page });

    const response = await input.fetchImpl(nextUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "temporal-git-backup/1.0",
      },
      signal:
        input.hooks.cancellationSignal === undefined
          ? AbortSignal.timeout(GITHUB_TIMEOUT_MS)
          : AbortSignal.any([
              input.hooks.cancellationSignal,
              AbortSignal.timeout(GITHUB_TIMEOUT_MS),
            ]),
    });

    const bodyText = redactGitSecrets(await response.text(), input.secrets);
    if (!response.ok) {
      throw new Error(
        `GitHub API GET ${input.stepLabel} failed with HTTP ${String(response.status)}: ${bodyText.slice(0, 500)}`,
      );
    }

    const parsedPage = PageArraySchema.parse(JSON.parse(bodyText));
    items.push(...parsedPage);
    nextUrl = parseNextLinkHeader(response.headers.get("link"));
  }

  return items;
}

function toDiscoveredRepository(
  raw: z.infer<typeof GitHubRepoSchema>,
): DiscoveredGitRepository {
  const wikiCloneUrl = raw.clone_url.endsWith(".git")
    ? `${raw.clone_url.slice(0, -4)}.wiki.git`
    : `${raw.clone_url}.wiki.git`;
  return {
    owner: raw.owner.login,
    name: raw.name,
    fullName: `${raw.owner.login}/${raw.name}`,
    cloneUrl: raw.clone_url,
    wikiCloneUrl,
    hasWiki: raw.has_wiki,
    hasIssues: raw.has_issues,
    archived: raw.archived,
    fork: raw.fork,
  };
}

export async function discoverGitHubRepositories(input: {
  readonly config: GitBackupConfig;
  readonly fetchImpl: GitHubApiFetch;
  readonly token: string;
  readonly secrets: readonly string[];
  readonly hooks: GitSubprocessHooks;
}): Promise<DiscoveredGitRepository[]> {
  const byFullName = new Map<string, DiscoveredGitRepository>();

  const userRepos = await fetchPaginatedGitHubArray({
    initialPath: `/user/repos?affiliation=owner,collaborator&per_page=${String(GITHUB_PAGE_SIZE)}`,
    itemSchema: GitHubRepoSchema,
    fetchImpl: input.fetchImpl,
    token: input.token,
    secrets: input.secrets,
    hooks: input.hooks,
    stepLabel: `discover-user:${input.config.user}`,
  });

  const orgRepoLists: z.infer<typeof GitHubRepoSchema>[][] = [];
  for (const org of input.config.organizations) {
    orgRepoLists.push(
      await fetchPaginatedGitHubArray({
        initialPath: `/orgs/${encodeURIComponent(org)}/repos?type=all&per_page=${String(GITHUB_PAGE_SIZE)}`,
        itemSchema: GitHubRepoSchema,
        fetchImpl: input.fetchImpl,
        token: input.token,
        secrets: input.secrets,
        hooks: input.hooks,
        stepLabel: `discover-org:${org}`,
      }),
    );
  }

  for (const raw of [...userRepos, ...orgRepoLists.flat()]) {
    if (!input.config.includeArchived && raw.archived) {
      continue;
    }
    if (!input.config.includeForks && raw.fork) {
      continue;
    }
    if (
      isExcludedRepository(
        { owner: raw.owner.login, name: raw.name },
        input.config.excludedRepositories,
      )
    ) {
      continue;
    }
    const discovered = toDiscoveredRepository(raw);
    byFullName.set(discovered.fullName.toLowerCase(), discovered);
  }

  return [...byFullName.values()].toSorted((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );
}

export async function fetchCompressedIssuesArchive(input: {
  readonly owner: string;
  readonly repo: string;
  readonly includeIssues: boolean;
  readonly capturedAt: string;
  readonly fetchImpl: GitHubApiFetch;
  readonly token: string;
  readonly secrets: readonly string[];
  readonly hooks: GitSubprocessHooks;
}): Promise<{
  compressed: Uint8Array;
  issueCount: number;
  contentDigest: string;
}> {
  const repoPath = `${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
  const issues = input.includeIssues
    ? await fetchPaginatedGitHubArray({
        initialPath: `/repos/${repoPath}/issues?state=all&sort=created&direction=asc&per_page=${String(GITHUB_PAGE_SIZE)}`,
        itemSchema: GitHubIssueSchema,
        fetchImpl: input.fetchImpl,
        token: input.token,
        secrets: input.secrets,
        hooks: input.hooks,
        stepLabel: `issues:${input.owner}/${input.repo}`,
      })
    : [];
  const comments =
    input.includeIssues && issues.length > 0
      ? await fetchPaginatedGitHubArray({
          initialPath: `/repos/${repoPath}/issues/comments?sort=id&direction=asc&per_page=${String(GITHUB_PAGE_SIZE)}`,
          itemSchema: GitHubIssueCommentSchema,
          fetchImpl: input.fetchImpl,
          token: input.token,
          secrets: input.secrets,
          hooks: input.hooks,
          stepLabel: `issue-comments:${input.owner}/${input.repo}`,
        })
      : [];

  const contentDigest = createHash("sha256")
    .update(JSON.stringify({ issues, comments }), "utf8")
    .digest("hex");
  const payload = JSON.stringify({
    schemaVersion: 1,
    repository: `${input.owner}/${input.repo}`,
    capturedAt: input.capturedAt,
    issues,
    comments,
  });
  const compressed = new Uint8Array(
    zstdCompressSync(Buffer.from(payload, "utf8")),
  );
  return { compressed, issueCount: issues.length, contentDigest };
}
