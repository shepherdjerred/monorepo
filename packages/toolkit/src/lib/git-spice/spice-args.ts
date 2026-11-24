import path from "node:path";

const GLOBAL_VALUE_FLAGS = new Set(
  "--gitlab-token --gitea-token --forgejo-token --bitbucket-token --azuredevops-token --github-url --gitlab-url --gitea-url --forgejo-url --bitbucket-url --azuredevops-url --gitlab-api-url --gitea-api-url --forgejo-api-url --bitbucket-api-url --bitbucket-kind --gitlab-oauth-client-id".split(
    " ",
  ),
);
const HELP_OR_VERSION_FLAGS = new Set(
  "-h --help --help=true --version --version=true".split(" "),
);
const SUBMIT_SHORTHANDS = new Set("bs ss uss dss submit".split(" "));
const SUBMIT_GROUPS = new Set(
  "branch b stack s upstack us downstack ds".split(" "),
);
const MERGE_SHORTHANDS = new Set("bm sm dsm merge".split(" "));
const MERGE_GROUPS = new Set("branch b stack s downstack ds".split(" "));
const SKIP_TOKEN_WORDS = new Set(["version", "dumpmd", "shell", "auth"]);
const REPO_GROUPS = new Set(["repo", "r"]);
const REBASE_GROUPS = new Set(["rebase", "rb"]);
const BRANCH_GROUPS = new Set(["branch", "b"]);

export type ParsedGitSpiceArgs = {
  readonly cwd: string;
  readonly words: readonly string[];
  readonly hasHelpOrVersion: boolean;
  readonly hasGithubTokenFlag: boolean;
  readonly hasGithubApiUrlFlag: boolean;
};

type ParseAccumulator = {
  cwd: string;
  readonly words: string[];
  stopWords: boolean;
  hasHelpOrVersion: boolean;
  hasGithubTokenFlag: boolean;
  hasGithubApiUrlFlag: boolean;
};

function dirStep(
  token: string,
  nextToken: string | undefined,
  currentCwd: string,
): { advance: number; nextCwd?: string | undefined } | null {
  if (token === "-C" || token === "--dir") {
    return nextToken === undefined
      ? { advance: 1 }
      : { advance: 2, nextCwd: path.resolve(currentCwd, nextToken) };
  }
  if (token.startsWith("--dir=")) {
    return { advance: 1, nextCwd: path.resolve(currentCwd, token.slice(6)) };
  }
  if (token.startsWith("-C") && !token.startsWith("--") && token.length > 2) {
    const raw = token.startsWith("-C=") ? token.slice(3) : token.slice(2);
    return { advance: 1, nextCwd: path.resolve(currentCwd, raw) };
  }
  return null;
}

function consumeFlagToken(
  token: string,
  nextToken: string | undefined,
  acc: ParseAccumulator,
): number {
  if (HELP_OR_VERSION_FLAGS.has(token)) {
    acc.hasHelpOrVersion = true;
    return 1;
  }
  if (token === "--github-token" || token.startsWith("--github-token=")) {
    acc.hasGithubTokenFlag = true;
    return token === "--github-token" ? 2 : 1;
  }
  if (token === "--github-api-url" || token.startsWith("--github-api-url=")) {
    acc.hasGithubApiUrlFlag = true;
    return token === "--github-api-url" ? 2 : 1;
  }
  const matchedDir = dirStep(token, nextToken, acc.cwd);
  if (matchedDir !== null) {
    if (matchedDir.nextCwd !== undefined) acc.cwd = matchedDir.nextCwd;
    return matchedDir.advance;
  }
  if (GLOBAL_VALUE_FLAGS.has(token)) return 2;
  if (acc.words.length >= 2) acc.stopWords = true;
  return 1;
}

export function parseGitSpiceArgs(
  args: readonly string[],
  defaultCwd: string = process.cwd(),
): ParsedGitSpiceArgs {
  const boundary = args.indexOf("--");
  const head = boundary === -1 ? args : args.slice(0, boundary);
  const acc: ParseAccumulator = {
    cwd: defaultCwd,
    words: [],
    stopWords: false,
    hasHelpOrVersion: false,
    hasGithubTokenFlag: false,
    hasGithubApiUrlFlag: false,
  };
  let index = 0;
  while (index < head.length) {
    const token = head[index];
    if (token === undefined) {
      index += 1;
    } else if (token.startsWith("-")) {
      index += consumeFlagToken(token, head[index + 1], acc);
    } else {
      if (!acc.stopWords && acc.words.length < 2) acc.words.push(token);
      index += 1;
    }
  }
  return acc;
}

export function effectiveCwd(
  args: readonly string[],
  defaultCwd: string = process.cwd(),
): string {
  return parseGitSpiceArgs(args, defaultCwd).cwd;
}

export function shouldSkipGitSpiceToken(args: readonly string[]): boolean {
  const { hasHelpOrVersion, words } = parseGitSpiceArgs(args);
  return (
    hasHelpOrVersion ||
    (words[0] !== undefined && SKIP_TOKEN_WORDS.has(words[0]))
  );
}

function matchesSubcommand(
  args: readonly string[],
  shorthands: ReadonlySet<string>,
  groups: ReadonlySet<string>,
  verbs: ReadonlySet<string>,
): boolean {
  const { hasHelpOrVersion, words } = parseGitSpiceArgs(args);
  const [first, second] = words;
  return (
    !hasHelpOrVersion &&
    first !== undefined &&
    (shorthands.has(first) ||
      (groups.has(first) && second !== undefined && verbs.has(second)))
  );
}

export function isSubmitCommand(args: readonly string[]): boolean {
  return matchesSubcommand(
    args,
    SUBMIT_SHORTHANDS,
    SUBMIT_GROUPS,
    new Set(["submit", "s"]),
  );
}
export function isMergeCommand(args: readonly string[]): boolean {
  return matchesSubcommand(
    args,
    MERGE_SHORTHANDS,
    MERGE_GROUPS,
    new Set(["merge", "m"]),
  );
}
export function isRepoSyncCommand(args: readonly string[]): boolean {
  return matchesSubcommand(
    args,
    new Set(["rs", "sync"]),
    REPO_GROUPS,
    new Set(["sync", "s"]),
  );
}
export function isRepoInitCommand(args: readonly string[]): boolean {
  return matchesSubcommand(
    args,
    new Set(["ri", "init"]),
    REPO_GROUPS,
    new Set(["init", "i"]),
  );
}
export function isRebaseContinueCommand(args: readonly string[]): boolean {
  return matchesSubcommand(
    args,
    new Set(["rbc"]),
    REBASE_GROUPS,
    new Set(["continue", "c"]),
  );
}
export function isBranchCreateCommand(args: readonly string[]): boolean {
  return matchesSubcommand(
    args,
    new Set(["bc"]),
    BRANCH_GROUPS,
    new Set(["create", "c"]),
  );
}
export function isForgeCommand(args: readonly string[]): boolean {
  const { hasHelpOrVersion, words } = parseGitSpiceArgs(args);
  return (
    !hasHelpOrVersion &&
    (words[0] === "review" ||
      isSubmitCommand(args) ||
      isMergeCommand(args) ||
      isRepoSyncCommand(args) ||
      isRepoInitCommand(args))
  );
}
