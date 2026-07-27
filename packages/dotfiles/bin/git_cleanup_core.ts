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
export type PullRequest = {
  readonly state: "OPEN" | "MERGED" | "CLOSED" | "NONE";
  readonly updatedAt?: Date;
};

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
        return text.slice(0, newline).replace(/\r$/, "");
      }
      result = await reader.read();
    }
    return `${text}${decoder.decode()}`.replace(/\r$/, "");
  } finally {
    reader.releaseLock();
  }
}

export function parseCleanupArguments(
  rawArguments: readonly string[],
  home: string,
): CleanupOptions {
  let directory = `${home}/git`;
  let apply = false;
  let yes = false;
  let checkPullRequests = true;
  let includeClosedPullRequests = false;
  let removeCleanWorktrees = false;
  let stalePullRequestDays = 21;
  let summary = false;
  let verbose = false;
  let color = true;
  for (let index = 0; index < rawArguments.length; index += 1) {
    const argument = rawArguments[index];
    if (argument === undefined) throw new Error("Missing argument");
    if (!argument.startsWith("-")) {
      directory = argument;
      continue;
    }
    switch (argument) {
      case "--apply":
        apply = true;
        break;
      case "--yes":
        yes = true;
        break;
      case "--no-prs":
        checkPullRequests = false;
        break;
      case "--include-closed-prs":
        includeClosedPullRequests = true;
        break;
      case "--remove-clean-worktrees":
        removeCleanWorktrees = true;
        break;
      case "--stale-pr-days": {
        const value = rawArguments[index + 1];
        if (value === undefined || !/^[1-9]\d*$/.test(value)) {
          throw new Error("--stale-pr-days requires a positive integer");
        }
        stalePullRequestDays = Number(value);
        index += 1;
        break;
      }
      case "--summary":
        summary = true;
        break;
      case "--verbose":
        verbose = true;
        break;
      case "--no-color":
        color = false;
        break;
      case "--help":
        throw new Error("help");
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  if (yes && !apply) throw new Error("--yes is only valid with --apply");
  return {
    directory,
    apply,
    yes,
    checkPullRequests,
    includeClosedPullRequests,
    removeCleanWorktrees,
    stalePullRequestDays,
    summary,
    verbose,
    color,
  };
}

export function parseWorktrees(output: string): Worktree[] {
  return output
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      let path: string | undefined;
      let branch: string | undefined;
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
        if (line.startsWith("branch refs/heads/")) {
          branch = line.slice("branch refs/heads/".length);
        }
      }
      if (path === undefined) throw new Error("Malformed git worktree output");
      return branch === undefined ? { path } : { path, branch };
    });
}

export function isSafeWorktree(status: string, commitsAhead: number): boolean {
  return status.length === 0 && commitsAhead === 0;
}

export function parsePullRequest(output: string): PullRequest {
  const value: unknown = JSON.parse(output);
  if (!Array.isArray(value) || value.length === 0) return { state: "NONE" };
  const first: unknown = value[0];
  if (typeof first !== "object" || first === null || !("state" in first)) {
    throw new Error("Malformed pull request response");
  }
  if (
    first.state !== "OPEN" &&
    first.state !== "MERGED" &&
    first.state !== "CLOSED"
  ) {
    throw new Error("Unexpected pull request state");
  }
  if (!("updatedAt" in first) || typeof first.updatedAt !== "string") {
    throw new Error("Pull request response lacks updatedAt");
  }
  const updatedAt = new Date(first.updatedAt);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new TypeError("Pull request response has an invalid updatedAt");
  }
  return { state: first.state, updatedAt };
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
  if (!color) return `${status} ${message}`;
  const code = status === "REMOVE" ? 32 : status === "WOULD REMOVE" ? 36 : 33;
  return `\u001B[${code.toString()}m${status}\u001B[0m ${message}`;
}
