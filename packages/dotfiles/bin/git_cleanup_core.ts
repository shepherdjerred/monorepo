import { z } from "zod";

export type CleanupOptions = {
  readonly directory: string;
  readonly apply: boolean;
  readonly yes: boolean;
  readonly checkPullRequests: boolean;
  readonly includeClosedPullRequests: boolean;
  readonly removeCleanWorktrees: boolean;
  readonly stalePullRequestDays: number;
  readonly summary: boolean;
  readonly verbose: boolean;
  readonly color: boolean;
};

export type Worktree = { readonly path: string; readonly branch?: string };

export type DetailedWorktree = {
  readonly path: string;
  readonly headSha?: string;
  readonly branch?: string;
  readonly detached: boolean;
  readonly locked: boolean;
};

export type PullRequest = {
  readonly state: "OPEN" | "MERGED" | "CLOSED" | "NONE";
  readonly updatedAt?: Date;
  readonly headRefOid?: string;
};

const PullRequestItemSchema = z.looseObject({
  state: z.string(),
  updatedAt: z.unknown().optional(),
  headRefName: z.string().optional(),
  headRefOid: z.string().optional(),
});

export async function readConfirmationLine(
  input: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = input.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    let result = await reader.read();
    while (!result.done) {
      text += decoder.decode(result.value, { stream: true });
      const newline = text.indexOf("\n");
      if (newline !== -1) {
        return text.slice(0, newline).replace(/\r$/u, "");
      }
      result = await reader.read();
    }
    return `${text}${decoder.decode()}`.replace(/\r$/u, "");
  } finally {
    reader.releaseLock();
  }
}

type MutableCleanupFlags = {
  directory: string;
  apply: boolean;
  yes: boolean;
  checkPullRequests: boolean;
  includeClosedPullRequests: boolean;
  removeCleanWorktrees: boolean;
  stalePullRequestDays: number;
  summary: boolean;
  verbose: boolean;
  color: boolean;
};

function applySingleOption(
  flags: MutableCleanupFlags,
  argument: string,
  nextArgument: string | undefined,
): number {
  switch (argument) {
    case "--apply":
      flags.apply = true;
      return 0;
    case "--yes":
      flags.yes = true;
      return 0;
    case "--no-prs":
      flags.checkPullRequests = false;
      return 0;
    case "--include-closed-prs":
      flags.includeClosedPullRequests = true;
      return 0;
    case "--remove-clean-worktrees":
      flags.removeCleanWorktrees = true;
      return 0;
    case "--stale-pr-days": {
      if (nextArgument === undefined || !/^[1-9]\d*$/u.test(nextArgument)) {
        throw new Error("--stale-pr-days requires a positive integer");
      }
      flags.stalePullRequestDays = Number(nextArgument);
      return 1;
    }
    case "--summary":
      flags.summary = true;
      return 0;
    case "--verbose":
      flags.verbose = true;
      return 0;
    case "--no-color":
      flags.color = false;
      return 0;
    case "--help":
      throw new Error("help");
    default:
      throw new Error(`Unknown option: ${argument}`);
  }
}

export function parseCleanupArguments(
  rawArguments: readonly string[],
  home: string,
): CleanupOptions {
  const flags: MutableCleanupFlags = {
    directory: `${home}/git`,
    apply: false,
    yes: false,
    checkPullRequests: true,
    includeClosedPullRequests: false,
    removeCleanWorktrees: false,
    stalePullRequestDays: 21,
    summary: false,
    verbose: false,
    color: true,
  };
  for (let index = 0; index < rawArguments.length; index += 1) {
    const argument = rawArguments[index];
    if (argument === undefined) {
      throw new Error("Missing argument");
    }
    if (!argument.startsWith("-")) {
      flags.directory = argument;
      continue;
    }
    index += applySingleOption(flags, argument, rawArguments[index + 1]);
  }
  if (flags.yes && !flags.apply) {
    throw new Error("--yes is only valid with --apply");
  }
  return flags;
}

export function parseWorktreesDetailed(output: string): DetailedWorktree[] {
  return output
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      let path: string | undefined;
      let headSha: string | undefined;
      let branch: string | undefined;
      let detached = false;
      let locked = false;
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) {
          path = line.slice("worktree ".length);
        } else if (line.startsWith("HEAD ")) {
          headSha = line.slice("HEAD ".length).trim();
        } else if (line.startsWith("branch refs/heads/")) {
          branch = line.slice("branch refs/heads/".length);
        } else if (line === "detached") {
          detached = true;
        } else if (line === "locked" || line.startsWith("locked ")) {
          locked = true;
        }
      }
      if (path === undefined) {
        throw new Error("Malformed git worktree output");
      }
      return {
        path,
        ...(headSha === undefined ? {} : { headSha }),
        ...(branch === undefined ? {} : { branch }),
        detached,
        locked,
      };
    });
}

export function parseWorktrees(output: string): Worktree[] {
  return parseWorktreesDetailed(output).map((wt) =>
    wt.branch === undefined
      ? { path: wt.path }
      : { path: wt.path, branch: wt.branch },
  );
}

export type SquashMergeSafetyContext = {
  readonly pullRequest?: PullRequest;
  readonly includeClosedPullRequests?: boolean;
  readonly headSha?: string;
  readonly latestCommitAtMs?: number;
};

function matchesPrHeadWithoutPostMergeCommits(
  pr: PullRequest,
  context: SquashMergeSafetyContext,
): boolean {
  return pr.headRefOid === undefined || context.headSha === undefined
    ? pr.updatedAt !== undefined &&
        context.latestCommitAtMs !== undefined &&
        context.latestCommitAtMs > 0 &&
        context.latestCommitAtMs <= pr.updatedAt.getTime()
    : pr.headRefOid === context.headSha;
}

export function isSafeWorktree(
  status: string,
  commitsAheadOfUpstream: number,
  commitsAheadOfDefaultBranch?: number,
  squashContext?: SquashMergeSafetyContext,
): boolean {
  if (status.length > 0) {
    return false;
  }
  if (
    commitsAheadOfDefaultBranch !== undefined &&
    commitsAheadOfDefaultBranch !== 0
  ) {
    return false;
  }
  if (commitsAheadOfUpstream === 0) {
    return true;
  }
  if (
    commitsAheadOfUpstream === Number.POSITIVE_INFINITY &&
    squashContext?.pullRequest !== undefined
  ) {
    const pr = squashContext.pullRequest;
    const prTerminal =
      pr.state === "MERGED" ||
      (squashContext.includeClosedPullRequests === true &&
        pr.state === "CLOSED");
    if (prTerminal && matchesPrHeadWithoutPostMergeCommits(pr, squashContext)) {
      return true;
    }
  }
  return false;
}

export function branchDeletionFlag(
  pullRequest: PullRequest,
  includeClosedPullRequests: boolean,
): "-d" | "-D" {
  return pullRequest.state === "MERGED" ||
    (includeClosedPullRequests && pullRequest.state === "CLOSED")
    ? "-D"
    : "-d";
}

function parseSinglePullRequestObject(raw: unknown): PullRequest {
  const item = PullRequestItemSchema.safeParse(raw);
  if (!item.success) {
    throw new Error("Malformed pull request response");
  }
  const { state, updatedAt: rawUpdatedAt, headRefOid } = item.data;
  if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") {
    throw new Error("Unexpected pull request state");
  }
  if (typeof rawUpdatedAt !== "string") {
    throw new TypeError("Pull request response lacks updatedAt");
  }
  const updatedAt = new Date(rawUpdatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new TypeError("Pull request response has an invalid updatedAt");
  }
  return {
    state,
    updatedAt,
    ...(headRefOid === undefined ? {} : { headRefOid }),
  };
}

export function parsePullRequest(output: string): PullRequest {
  const value: unknown = JSON.parse(output);
  return !Array.isArray(value) || value.length === 0
    ? { state: "NONE" }
    : parseSinglePullRequestObject(value[0]);
}

function shouldPreferPullRequest(
  existing: PullRequest | undefined,
  candidate: PullRequest,
): boolean {
  if (existing === undefined) {
    return true;
  }
  if (existing.state === "OPEN" && candidate.state !== "OPEN") {
    return false;
  }
  if (existing.state !== "OPEN" && candidate.state === "OPEN") {
    return true;
  }
  const existingTime = existing.updatedAt?.getTime() ?? 0;
  const candidateTime = candidate.updatedAt?.getTime() ?? 0;
  return candidateTime === existingTime
    ? candidate.state === "MERGED" && existing.state !== "MERGED"
    : candidateTime > existingTime;
}

export function parseBatchPullRequests(
  output: string,
): Map<string, PullRequest> {
  const map = new Map<string, PullRequest>();
  const value: unknown = JSON.parse(output);
  if (!Array.isArray(value)) {
    return map;
  }
  for (const rawItem of value) {
    const parsedItem = PullRequestItemSchema.safeParse(rawItem);
    const branch = parsedItem.success ? parsedItem.data.headRefName : undefined;
    if (branch === undefined || branch.length === 0) {
      continue;
    }
    const candidate = parseSinglePullRequestObject(rawItem);
    if (shouldPreferPullRequest(map.get(branch), candidate)) {
      map.set(branch, candidate);
    }
  }
  return map;
}

export function pullRequestAgeInDays(
  updatedAt: Date,
  now: Date = new Date(),
): number {
  return Math.floor((now.getTime() - updatedAt.getTime()) / 86_400_000);
}

export function formatStatus(
  status: "KEEP" | "REMOVE" | "STALE" | "WOULD REMOVE",
  message: string,
  color: boolean,
): string {
  if (!color) {
    return `${status} ${message}`;
  }
  const code = status === "REMOVE" ? 32 : status === "WOULD REMOVE" ? 36 : 33;
  return `\u{1B}[${code.toString()}m${status}\u{1B}[0m ${message}`;
}
