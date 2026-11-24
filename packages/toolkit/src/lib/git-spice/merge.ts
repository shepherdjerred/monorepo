import { z } from "zod";
import {
  lookupExecutable,
  spawnPassthroughInvocation,
} from "#lib/passthrough.ts";
import { spawnCapture, type CapturedResult } from "#lib/spawn-capture.ts";
import { parseGitSpiceArgs } from "./spice-args.ts";
import {
  gitExecutable,
  readSpiceBranches,
  readSpiceRepoConfig as readRawSpiceRepo,
  type SpiceBranchMetadata,
} from "./spice-state.ts";

const DEFAULT_GITHUB_API = "https://api.github.com";
const POLL_BACKOFF_MS = [200, 400, 800, 1000] as const;
const GH_URL_RE =
  /^(?:(?:ssh:\/\/)?git@github\.com[:/]|https?:\/\/(?:[^@/\s]+@)?github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/;
const CommentUrlSchema = z.object({ url: z.string().optional() }).optional();
const BranchGhSchema = z.object({ comment: CommentUrlSchema }).optional();
const BranchExtraSchema = z.object({
  upstream: z.object({ branch: z.string().min(1).optional() }).optional(),
  change: z.object({ github: BranchGhSchema }).optional(),
});
const PullSummaryListSchema = z.array(
  z.object({ number: z.number().int().positive() }),
);
export const GitHubPullSchema = z.object({
  number: z.number().int().positive(),
  state: z.string().optional(),
  draft: z.boolean().optional(),
  title: z.string().optional(),
  body: z.string().nullable().optional(),
  head: z.object({ sha: z.string() }).optional(),
  merged: z.boolean().optional(),
  merge_commit_sha: z.string().nullable().optional(),
});
export type SubmitScope = "branch" | "stack" | "upstack" | "downstack";
export type SpiceRepoConfig = { trunk: string; remote: string };
export type GitHubPull = z.infer<typeof GitHubPullSchema>;
export type EnvMap = Readonly<Record<string, string | undefined>>;
export type GitSpiceSpawnContext = {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
};
type Ctx = GitSpiceSpawnContext;
export type SpawnFn = (a: readonly string[], c: Ctx) => Promise<number>;
export type GitRunner = (
  a: readonly string[],
  cwd: string,
) => Promise<CapturedResult>;
export type FetchLike = (u: string | URL, i?: RequestInit) => Promise<Response>;
export type GitHubApi = {
  readonly apiBase: string;
  readonly repoSlug: string;
  readonly token: string;
  readonly fetchImpl: FetchLike;
};
export type RepoCtx = {
  readonly cwd: string;
  readonly remote: string;
  readonly hintBranch?: string | null | undefined;
};
export type GitSpiceMergeOptions = {
  readonly cwd?: string | undefined;
  readonly env?: EnvMap | undefined;
  readonly githubToken?: string | null | undefined;
  readonly githubRepo?: string | null | undefined;
  readonly githubApiUrl?: string | undefined;
  readonly spawnGitSpice?: SpawnFn | undefined;
  readonly runGit?: GitRunner | undefined;
  readonly fetchImpl?: FetchLike | undefined;
  readonly stderr?: ((message: string) => void) | undefined;
};
type PullMeta = {
  readonly title: string | undefined;
  readonly body: string | undefined;
};
type PreMerge = {
  branch: string | null;
  prNumber: number | null;
  upstack: readonly string[];
};
export type PollTiming = {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
  readonly writeStderr: (m: string) => void;
};
function defaultStderr(msg: string): void {
  console.error(msg);
}
export function createBaseIo(options: GitSpiceMergeOptions) {
  const baseCwd = options.cwd ?? process.cwd();
  const env = { ...(options.env ?? Bun.env) };
  const writeStderr = options.stderr ?? defaultStderr;
  const git = gitExecutable(env);
  const runGit: GitRunner =
    options.runGit ?? ((g, cwd) => spawnCapture([git, ...g], { cwd, env }));
  const spawn: SpawnFn =
    options.spawnGitSpice ?? ((a, ctx) => defaultSpawn(a, ctx, writeStderr));
  return { baseCwd, env, writeStderr, runGit, spawn };
}
function githubRequest(
  a: Api,
  method: "GET" | "PATCH",
  ep: string,
  b?: unknown,
) {
  return a.fetchImpl(`${a.apiBase}${ep}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${a.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "shepherdjerred-toolkit",
      ...(b === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(b === undefined ? {} : { body: JSON.stringify(b) }),
  });
}
async function fetchGitHubJson<T>(
  api: GitHubApi,
  endpoint: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const res = await githubRequest(api, "GET", endpoint);
    const parsed = res.ok ? schema.safeParse(await res.json()) : null;
    return parsed?.success === true ? parsed.data : null;
  } catch {
    return null;
  }
}
export function getPullDetail(api: GitHubApi, n: number) {
  const ep = `/repos/${api.repoSlug}/pulls/${String(n)}`;
  return fetchGitHubJson(api, ep, GitHubPullSchema);
}
export async function patchPullMetadata(
  prNumber: number,
  meta: PullMeta,
  api: GitHubApi,
  writeStderr: (m: string) => void,
): Promise<number> {
  const payload = {
    ...(meta.title === undefined ? {} : { title: meta.title }),
    ...(meta.body === undefined ? {} : { body: meta.body }),
  };
  const ep = `/repos/${api.repoSlug}/pulls/${String(prNumber)}`;
  const res = await githubRequest(api, "PATCH", ep, payload);
  const p = res.ok ? GitHubPullSchema.safeParse(await res.json()) : null;
  const ok =
    p?.success === true &&
    (meta.title === undefined || p.data.title === meta.title) &&
    (meta.body === undefined || (p.data.body ?? "") === meta.body);
  if (!ok) {
    writeStderr(
      `ERROR toolkit: failed to update/verify PR #${String(prNumber)} metadata.`,
    );
  }
  return ok ? 0 : 1;
}
export async function readBranchExtra(g: GitRunner, cwd: string, b: string) {
  const blob = await g(["show", `refs/spice/data:branches/${b}`], cwd);
  if (blob.exitCode !== 0) {
    return { upstream: undefined, commentUrl: undefined };
  }
  try {
    const raw: unknown = JSON.parse(blob.stdout);
    const d = BranchExtraSchema.safeParse(raw).data;
    return {
      upstream: d?.upstream?.branch,
      commentUrl: d?.change?.github?.comment?.url,
    };
  } catch {
    return { upstream: undefined, commentUrl: undefined };
  }
}
type Api = GitHubApi;
export async function resolveOpenPrNumber(
  n: number | undefined,
  u: string,
  a: Api,
) {
  if (n !== undefined) {
    return n;
  }
  const owner = a.repoSlug.split("/")[0] ?? "";
  const ep = `/repos/${a.repoSlug}/pulls?head=${encodeURIComponent(`${owner}:${u}`)}&state=open`;
  const list = await fetchGitHubJson(a, ep, PullSummaryListSchema);
  return list?.[0]?.number ?? null;
}
export async function resolveAnchorBranch(
  exp: string | undefined,
  g: GitRunner,
  cwd: string,
) {
  let branch = exp ?? null;
  if (branch === null) {
    const cur = await g(["branch", "--show-current"], cwd);
    const name = cur.stdout.trim();
    branch = cur.exitCode === 0 && name.length > 0 ? name : null;
  }
  const ref = branch === null ? "HEAD" : `refs/heads/${branch}^{commit}`;
  const rev = await g(["rev-parse", "--verify", ref], cwd);
  return { branch, sha: rev.exitCode === 0 ? rev.stdout.trim() : "unknown" };
}
export async function resolveBranchShas(
  bs: readonly string[],
  g: GitRunner,
  cwd: string,
) {
  const map = new Map<string, string>();
  for (const b of bs) {
    const ref = `refs/heads/${b}^{commit}`;
    const r = await g(["rev-parse", "--verify", ref], cwd);
    if (r.exitCode === 0 && r.stdout.trim().length > 0) {
      map.set(b, r.stdout.trim());
    }
  }
  return map;
}
function listDescendants(
  root: string,
  trunk: string,
  map: ReadonlyMap<string, SpiceBranchMetadata>,
): string[] {
  const out = root === trunk ? [] : [root];
  const seen = new Set([root]);
  for (const cur of out) {
    const kids = [...map.values()]
      .filter(
        (s) => !seen.has(s.name) && s.baseName === cur && s.name !== trunk,
      )
      .map((s) => s.name)
      .sort((a, b) => a.localeCompare(b));
    for (const k of kids) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
export function computeScopeBranches(
  scope: SubmitScope,
  anchor: string,
  trunk: string,
  map: ReadonlyMap<string, SpiceBranchMetadata>,
): string[] {
  if (scope === "branch") {
    return anchor === trunk ? [] : [anchor];
  }
  if (scope === "upstack") {
    return listDescendants(anchor, trunk, map);
  }
  const chain = anchor === trunk ? [] : [anchor];
  const seen = new Set(chain);
  let p = anchor === trunk ? undefined : map.get(anchor)?.baseName;
  while (p !== undefined && p !== trunk && !seen.has(p)) {
    seen.add(p);
    chain.push(p);
    p = map.get(p)?.baseName;
  }
  chain.reverse();
  return scope === "downstack"
    ? chain
    : listDescendants(chain[0] ?? trunk, trunk, map);
}
export async function clearTrunkUpstreams(
  cfg: SpiceRepoConfig,
  io: ReturnType<typeof createBaseIo>,
  cwd: string,
) {
  const fmt = "--format=%(refname:short)\t%(upstream:short)";
  const refs = await io.runGit(["for-each-ref", fmt, "refs/heads"], cwd);
  if (refs.exitCode !== 0) {
    return true;
  }
  const trunk = cfg.trunk;
  const target = `${cfg.remote}/${trunk}`;
  for (const line of refs.stdout.split(/\r?\n/)) {
    const [b = "", up = ""] = line.split("\t").map((s) => s.trim());
    if (b === "" || up !== target || b === trunk) {
      continue;
    }
    const res = await io.runGit(["branch", "--unset-upstream", b], cwd);
    if (res.exitCode !== 0) {
      io.writeStderr(
        `ERROR toolkit: failed to clear ${target} upstream on branch ${b}: ${res.stderr.trim()}`,
      );
      return false;
    }
    io.writeStderr(`toolkit: cleared ${target} upstream on branch ${b}`);
  }
  return true;
}
export async function waitForPrHeadSha(
  target: { branch: string; prNumber: number; localSha: string },
  api: GitHubApi,
  timing: PollTiming,
): Promise<boolean> {
  const deadline = timing.now() + timing.timeoutMs;
  let last = "unknown";
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const pr = await getPullDetail(api, target.prNumber);
    if (pr?.head?.sha !== undefined) {
      last = pr.head.sha;
      if (last === target.localSha) {
        return true;
      }
    }
    const rem = deadline - timing.now();
    if (rem <= 0) {
      break;
    }
    await timing.sleep(Math.min(POLL_BACKOFF_MS.at(attempt) ?? 1000, rem));
  }
  timing.writeStderr(
    `ERROR toolkit: timed out waiting for PR #${String(target.prNumber)} (${target.branch}) head to reach ${target.localSha} (last ${last}); refusing to mark ready on stale head.`,
  );
  return false;
}
async function defaultSpawn(
  args: readonly string[],
  ctx: Ctx,
  writeStderr: (msg: string) => void,
): Promise<number> {
  const exe = lookupExecutable("git-spice", ctx.env["PATH"], ctx.env["HOME"]);
  if (exe === null) {
    writeStderr("toolkit: required executable not found: git-spice");
    return 127;
  }
  return spawnPassthroughInvocation(
    { executable: "git-spice", args, env: ctx.env },
    { cwd: ctx.cwd },
  );
}
export async function readRepoConfigWithDefaults(cwd: string, env: EnvMap) {
  const r = await readRawSpiceRepo(cwd, env);
  const t = r?.trunk ?? "";
  const rem = r?.remote ?? "";
  return {
    trunk: t.length > 0 ? t : "main",
    remote: rem.length > 0 ? rem : "origin",
  };
}
function parseRepoUrl(rawUrl: string): string | null {
  const [, owner, repo] = GH_URL_RE.exec(rawUrl.trim()) ?? [];
  return owner === undefined || repo === undefined ? null : `${owner}/${repo}`;
}
async function resolveToken(
  explicit: string | null | undefined,
  env: EnvMap,
  cwd: string,
): Promise<string | null> {
  if (explicit === undefined) {
    const fromEnv = (env["GH_TOKEN"] ?? "").trim();
    if (fromEnv.length > 0) {
      return fromEnv;
    }
    try {
      const gh = await spawnCapture(["gh", "auth", "token"], { cwd, env });
      const out = gh.stdout.trim();
      return gh.exitCode === 0 && out.length > 0 ? out : null;
    } catch {
      return null;
    }
  }
  const val = explicit?.trim() ?? "";
  return val.length > 0 ? val : null;
}
async function discoverRepoSlug(
  explicit: string | null | undefined,
  env: EnvMap,
  runGit: GitRunner,
  ctx: RepoCtx,
): Promise<string | null> {
  if (explicit !== undefined) {
    return explicit;
  }
  const urlRes = await runGit(["remote", "get-url", ctx.remote], ctx.cwd);
  const fromRemote = urlRes.exitCode === 0 ? parseRepoUrl(urlRes.stdout) : null;
  if (fromRemote !== null) {
    return fromRemote;
  }
  if (ctx.hintBranch !== undefined && ctx.hintBranch !== null) {
    const extra = await readBranchExtra(runGit, ctx.cwd, ctx.hintBranch);
    const fromComment =
      extra.commentUrl === undefined ? null : parseRepoUrl(extra.commentUrl);
    if (fromComment !== null) {
      return fromComment;
    }
  }
  const ghRepo = env["GH_REPO"]?.trim() ?? "";
  return /^[^/\s]+\/[^/\s]+$/.test(ghRepo) ? ghRepo : null;
}
export async function buildGitHubApi(
  opts: GitSpiceMergeOptions,
  env: EnvMap,
  runGit: GitRunner,
  ctx: RepoCtx,
): Promise<GitHubApi | null> {
  const [token, repoSlug] = await Promise.all([
    resolveToken(opts.githubToken, env, ctx.cwd),
    discoverRepoSlug(opts.githubRepo, env, runGit, ctx),
  ]);
  if (token === null || repoSlug === null) {
    return null;
  }
  const raw = (opts.githubApiUrl ?? env["GITHUB_API_URL"] ?? "").trim();
  const base = raw.length > 0 ? raw : DEFAULT_GITHUB_API;
  return {
    apiBase: base.replace(/\/+$/, ""),
    repoSlug,
    token,
    fetchImpl: opts.fetchImpl ?? fetch,
  };
}
function extractMergeBranches(args: readonly string[]): string[] {
  const cut = args.indexOf("--");
  const head = cut === -1 ? args : args.slice(0, cut);
  const branches: string[] = [];
  for (let i = 0; i < head.length; i += 1) {
    const arg = head[i] ?? "";
    const next = head[i + 1];
    if (arg === "--branch" && next !== undefined) {
      branches.push(...next.split(",").filter(Boolean));
      i += 1;
    } else if (arg.startsWith("--branch=")) {
      branches.push(...arg.slice(9).split(",").filter(Boolean));
    } else if (arg === "-C" || arg === "--dir") {
      i += 1;
    }
  }
  return branches;
}
export function isBranchMergeSubcommand(args: readonly string[]): boolean {
  const [w0, w1] = parseGitSpiceArgs(args).words;
  return (
    w0 === "bm" ||
    ((w0 === "branch" || w0 === "b") && (w1 === "merge" || w1 === "m"))
  );
}
async function readPreMergeTarget(
  args: readonly string[],
  parsed: ReturnType<typeof parseGitSpiceArgs>,
  runGit: GitRunner,
  env: EnvMap,
): Promise<PreMerge> {
  const explicit = extractMergeBranches(args);
  if (parsed.hasHelpOrVersion || explicit.length > 1) {
    return { branch: null, prNumber: null, upstack: [] };
  }
  const anchor = await resolveAnchorBranch(explicit[0], runGit, parsed.cwd);
  if (anchor.branch === null) {
    return { branch: null, prNumber: null, upstack: [] };
  }
  const branches = await readSpiceBranches(parsed.cwd, env);
  const prNumber = branches.get(anchor.branch)?.prNumber ?? null;
  const upstack = [...branches.values()]
    .filter((st) => st.name !== anchor.branch && st.baseName === anchor.branch)
    .map((st) => st.name)
    .sort((a, b) => a.localeCompare(b));
  return { branch: anchor.branch, prNumber, upstack };
}
export async function runGitSpiceBranchMerge(
  args: readonly string[],
  options: GitSpiceMergeOptions = {},
): Promise<number> {
  const io = createBaseIo(options);
  const parsed = parseGitSpiceArgs(args, io.baseCwd);
  const pre = await readPreMergeTarget(args, parsed, io.runGit, io.env);
  const code = await io.spawn(args, { cwd: io.baseCwd, env: io.env });
  if (code === 0 || pre.prNumber === null) {
    return code;
  }
  const cfg = await readRepoConfigWithDefaults(parsed.cwd, io.env);
  const api = await buildGitHubApi(options, io.env, io.runGit, {
    cwd: parsed.cwd,
    remote: cfg.remote,
    hintBranch: pre.branch,
  });
  const pr = api === null ? null : await getPullDetail(api, pre.prNumber);
  if (pr?.merged !== true) {
    return code;
  }
  const sha = pr.merge_commit_sha ?? "unknown";
  const num = String(pre.prNumber);
  if (pre.upstack.length === 0) {
    io.writeStderr(
      `WARN toolkit: PR #${num} merged on GitHub (${sha}); git-spice post-merge local trunk sync exited ${String(code)} (other worktrees left untouched).`,
    );
    return 0;
  }
  io.writeStderr(
    `ERROR toolkit: PR #${num} merged on GitHub (${sha}) — do NOT retry merging #${num} — but git-spice exited ${String(code)} before reconciling upstack branch(es): ${pre.upstack.join(", ")}.`,
  );
  return code;
}
