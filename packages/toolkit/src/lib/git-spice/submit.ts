import path from "node:path";
import {
  buildGitHubApi,
  clearTrunkUpstreams,
  computeScopeBranches,
  createBaseIo,
  getPullDetail,
  patchPullMetadata,
  readBranchExtra,
  readRepoConfigWithDefaults,
  resolveAnchorBranch,
  resolveBranchShas,
  resolveOpenPrNumber,
  waitForPrHeadSha,
  type GitHubApi,
  type GitHubPull,
  type GitSpiceMergeOptions,
  type SpiceRepoConfig,
  type SubmitScope,
} from "./merge.ts";
import { parseGitSpiceArgs } from "./spice-args.ts";
import { readSpiceBranches, type SpiceBranchMetadata } from "./spice-state.ts";

const POLL_TIMEOUT_MS = 15_000;
const BODY_SENTINEL = "\0TOOLKIT_BODY\0";
type BranchMap = ReadonlyMap<string, SpiceBranchMetadata>;
type BaseIo = ReturnType<typeof createBaseIo>;
type StaleDraft = { branch: string; prNumber: number; localSha: string };
export type GitSpiceSubmitOptions = GitSpiceMergeOptions & {
  readonly readTextFile?: ((filePath: string) => Promise<string>) | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
  readonly readyPollTimeoutMs?: number | undefined;
};
const SEP_VAL_FLAGS = new Set(
  "-C --dir --branch --title --body --body-file -l --label -r --reviewer -a --assign".split(
    " ",
  ),
);
const P2_PASSTHROUGH = new Set(
  "--prompt --no-prompt -v --verbose --nav-comment -w --web --no-web --no-verify".split(
    " ",
  ),
);
const SCOPE_MAP: Readonly<Record<string, SubmitScope>> = {
  bs: "branch",
  ss: "stack",
  uss: "upstack",
  dss: "downstack",
  branch: "branch",
  b: "branch",
  stack: "stack",
  s: "stack",
  upstack: "upstack",
  us: "upstack",
  downstack: "downstack",
  ds: "downstack",
};
function scopeFromWords([w0 = "", w1]: readonly string[]): SubmitScope | null {
  if (w0 === "bs" || w0 === "ss" || w0 === "uss" || w0 === "dss") {
    return SCOPE_MAP[w0] ?? null;
  }
  return w1 === "submit" || w1 === "s" ? (SCOPE_MAP[w0] ?? null) : null;
}
export function isSubmitSubcommand(args: readonly string[]): boolean {
  return scopeFromWords(parseGitSpiceArgs(args).words) !== null;
}
export function isBranchSubmitSubcommand(args: readonly string[]): boolean {
  return scopeFromWords(parseGitSpiceArgs(args).words) === "branch";
}
function stepArgPair(head: readonly string[], i: number): number {
  const a = head[i] ?? "";
  const n = head[i + 1] ?? "";
  const sep = head[i + 1] !== undefined && SEP_VAL_FLAGS.has(a);
  const nav = a === "--nav-comment" && /^(?:true|false|multiple)$/.test(n);
  const web =
    (a === "-w" || a === "--web") && /^(?:true|false|created)$/.test(n);
  return sep || nav || web ? 2 : 1;
}
function shortClusterHas(arg: string, ch: string): boolean {
  return /^-[ncuwvh]+$/.test(arg) && arg.includes(ch);
}
function emptyAcc(str?: string) {
  return {
    dryRun: false,
    updateOnly: false,
    noPublish: false,
    wantsReady: false,
    hasDirectBody: false,
    missingBodyFile: false,
    branch: str,
    title: str,
    body: str,
    bodyFiles: str === undefined ? [] : [str],
  };
}
type FlagAcc = ReturnType<typeof emptyAcc>;
function applyToggle(st: FlagAcc, key: string, val: string | undefined): void {
  if (key === "-n" || key === "--dry-run" || shortClusterHas(key, "n")) {
    st.dryRun = val !== "false";
  } else if (key === "--no-dry-run") {
    st.dryRun = false;
  }
  if (key === "-u" || key === "--update-only" || shortClusterHas(key, "u")) {
    st.updateOnly = val !== "false";
  } else if (key === "--no-update-only") {
    st.updateOnly = false;
  }
  if (key === "--no-publish" || key === "--publish") {
    st.noPublish = key === "--no-publish" || val === "false";
  }
}
function applyToken(st: FlagAcc, key: string, val: string | undefined) {
  if (key === "--body-file") {
    if (val === undefined || val.length === 0) {
      st.missingBodyFile = true;
    } else {
      st.bodyFiles.push(val);
    }
    return "body-file" as const;
  }
  if (key === "--no-draft" || (key === "--draft" && val === "false")) {
    st.wantsReady = true;
    return "strip" as const;
  }
  switch (key) {
    case "--draft":
      st.wantsReady = false;
      break;
    case "--body":
      st.hasDirectBody = true;
      st.body = val ?? st.body;
      break;
    case "--title":
      st.title = val ?? st.title;
      break;
    case "--branch":
      st.branch = val ?? st.branch;
      break;
    default:
      applyToggle(st, key, val);
  }
  return "keep" as const;
}
function splitKeyVal(slice: readonly string[]) {
  const first = slice[0] ?? "";
  if (slice.length === 2) {
    return { key: first, val: slice[1] };
  }
  const eq = first.startsWith("--") ? first.indexOf("=") : -1;
  return eq === -1
    ? { key: first, val: undefined }
    : { key: first.slice(0, eq), val: first.slice(eq + 1) };
}
function keepForPhaseTwo(key: string, isWord: boolean): boolean {
  return (
    isWord ||
    key === "-C" ||
    key === "--dir" ||
    key === "--branch" ||
    (key.startsWith("-C") && !key.startsWith("--")) ||
    P2_PASSTHROUGH.has(key)
  );
}
function scanSubmitCli(args: readonly string[], baseCwd: string) {
  const base = parseGitSpiceArgs(args, baseCwd);
  const cut = args.indexOf("--");
  const head = cut === -1 ? args : args.slice(0, cut);
  const tail = cut === -1 ? [] : args.slice(cut);
  const full: string[] = [];
  const p1: string[] = [];
  const p2: string[] = [];
  const st = emptyAcc();
  let wordsSeen = 0;
  for (let i = 0; i < head.length;) {
    const step = stepArgPair(head, i);
    const slice = head.slice(i, i + step);
    const { key, val } = splitKeyVal(slice);
    const isWord = !key.startsWith("-") && wordsSeen < base.words.length;
    if (isWord) {
      wordsSeen += 1;
    }
    const act = applyToken(st, key, val);
    if (act === "body-file") {
      full.push("--body", BODY_SENTINEL);
      p1.push("--body", BODY_SENTINEL);
    } else if (act === "strip") {
      full.push(...slice);
    } else {
      full.push(...slice);
      p1.push(...slice);
    }
    if (keepForPhaseTwo(key, isWord)) {
      p2.push(...slice);
    }
    i += step;
  }
  const { cwd: repoCwd, hasHelpOrVersion: hasHelp, words } = base;
  return {
    ...st,
    scope: scopeFromWords(words),
    repoCwd,
    hasHelp,
    full,
    p1,
    p2,
    tail,
  };
}
async function materializeCli(
  scan: ReturnType<typeof scanSubmitCli>,
  baseCwd: string,
  readText: (p: string) => Promise<string>,
  writeStderr: (m: string) => void,
) {
  if (scan.missingBodyFile) {
    writeStderr("ERROR toolkit: --body-file requires a file path.");
    return null;
  }
  if (scan.hasDirectBody && scan.bodyFiles.length > 0) {
    writeStderr("ERROR toolkit: cannot combine --body and --body-file.");
    return null;
  }
  if (scan.bodyFiles.length > 1) {
    writeStderr("ERROR toolkit: --body-file may only be specified once.");
    return null;
  }
  let { body, full, p1 } = scan;
  const raw = scan.bodyFiles[0];
  if (raw !== undefined) {
    try {
      const text = await readText(path.resolve(baseCwd, raw));
      body = text;
      full = full.map((t) => (t === BODY_SENTINEL ? text : t));
      p1 = p1.map((t) => (t === BODY_SENTINEL ? text : t));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      writeStderr(`ERROR toolkit: failed to read --body-file ${raw}: ${msg}`);
      return null;
    }
  }
  const fullArgs = [...full, ...scan.tail];
  const phaseOneArgs = [...p1, ...scan.tail];
  const phaseTwoArgs = [...scan.p2, "--no-draft", "--update-only"];
  return { ...scan, body, fullArgs, phaseOneArgs, phaseTwoArgs };
}
type ParsedCli = NonNullable<Awaited<ReturnType<typeof materializeCli>>>;
type Rt = {
  readonly io: BaseIo;
  readonly parsed: ParsedCli;
  readonly cfg: SpiceRepoConfig;
  readonly targets: readonly string[];
  readonly anchor: { branch: string | null; sha: string };
  readonly options: GitSpiceSubmitOptions;
};
async function findStaleDrafts(rt: Rt, pre: BranchMap, api: GitHubApi) {
  const shas = await resolveBranchShas(
    rt.targets,
    rt.io.runGit,
    rt.parsed.repoCwd,
  );
  const stale: StaleDraft[] = [];
  for (const branch of rt.targets) {
    const localSha = shas.get(branch);
    const prNumber = pre.get(branch)?.prNumber;
    if (localSha === undefined || prNumber === undefined) {
      continue;
    }
    const pr = await getPullDetail(api, prNumber);
    if (
      pr?.state === "open" &&
      pr.draft === true &&
      pr.head?.sha !== localSha
    ) {
      stale.push({ branch, prNumber, localSha });
    }
  }
  return stale;
}
async function verifyRemoteHeads(rt: Rt): Promise<BranchMap | null> {
  const { repoCwd, updateOnly } = rt.parsed;
  const [postMap, shas] = await Promise.all([
    readSpiceBranches(repoCwd, rt.io.env),
    resolveBranchShas(rt.targets, rt.io.runGit, repoCwd),
  ]);
  for (const branch of rt.targets) {
    const localSha = shas.get(branch);
    const extra = await readBranchExtra(rt.io.runGit, repoCwd, branch);
    const tracked =
      extra.upstream !== undefined ||
      postMap.get(branch)?.prNumber !== undefined;
    if (localSha === undefined || (updateOnly && !tracked)) {
      continue;
    }
    const ref = `refs/heads/${extra.upstream ?? branch}`;
    const ls = await rt.io.runGit(["ls-remote", rt.cfg.remote, ref], repoCwd);
    const failed = ls.exitCode !== 0;
    const remoteSha = failed ? "" : (ls.stdout.trim().split(/\s+/)[0] ?? "");
    if (failed || remoteSha !== localSha) {
      rt.io.writeStderr(
        failed
          ? `ERROR toolkit: failed to verify remote head via git ls-remote ${rt.cfg.remote} ${ref}: ${ls.stderr.trim()}`
          : `ERROR toolkit: remote head SHA mismatch after git-spice submit for branch ${branch} (${rt.cfg.remote} ${ref}): expected local ${localSha}, got remote ${remoteSha || "<missing>"}.`,
      );
      return null;
    }
  }
  return postMap;
}
function metaDiffers(pr: GitHubPull, p: ParsedCli): boolean {
  return (
    (p.title !== undefined && p.title !== (pr.title ?? "")) ||
    (p.body !== undefined && p.body !== (pr.body ?? ""))
  );
}
async function loadOpenBranchPr(rt: Rt, rec: number | undefined, a: GitHubApi) {
  const b = rt.anchor.branch ?? "";
  const extra = await readBranchExtra(rt.io.runGit, rt.parsed.repoCwd, b);
  const prNumber = await resolveOpenPrNumber(rec, extra.upstream ?? b, a);
  const pr = prNumber === null ? null : await getPullDetail(a, prNumber);
  return { prNumber, pr };
}
async function syncOpenPrMetadata(
  rt: Rt,
  post: BranchMap,
  a: GitHubApi | null,
) {
  const branch = rt.anchor.branch;
  if (branch === null) {
    return 0;
  }
  const recordedPr = post.get(branch)?.prNumber;
  if (a === null) {
    if (recordedPr === undefined) {
      return 0;
    }
    rt.io.writeStderr(
      `ERROR toolkit: GitHub credentials unavailable to verify PR #${String(recordedPr)} metadata update.`,
    );
    return 1;
  }
  const [latest, open] = await Promise.all([
    resolveAnchorBranch(branch, rt.io.runGit, rt.parsed.repoCwd),
    loadOpenBranchPr(rt, recordedPr, a),
  ]);
  if (open.prNumber === null) {
    if (rt.parsed.noPublish || rt.parsed.updateOnly) {
      return 0;
    }
    rt.io.writeStderr(
      `ERROR toolkit: could not locate open PR for branch ${branch} to verify metadata update.`,
    );
    return 1;
  }
  if (open.pr?.state !== "open" || open.pr.head?.sha !== latest.sha) {
    const why =
      open.pr?.state === "open"
        ? `PR head (${open.pr.head?.sha ?? "unknown"}) does not match local branch ${branch} (${latest.sha})`
        : `state is "${open.pr?.state ?? "unreachable"}" (expected "open")`;
    rt.io.writeStderr(
      `ERROR toolkit: refusing to update PR #${String(open.prNumber)} metadata because ${why}.`,
    );
    return 1;
  }
  return metaDiffers(open.pr, rt.parsed)
    ? patchPullMetadata(open.prNumber, rt.parsed, a, rt.io.writeStderr)
    : 0;
}
function failSubmit(rt: Rt, code: number): number {
  const name = rt.anchor.branch ?? "<detached>";
  rt.io.writeStderr(
    `ERROR toolkit: git-spice submit failed (exit ${String(code)}); local branch ${name} (${rt.anchor.sha}) was NOT pushed or verified.`,
  );
  return code;
}
async function executeLivePhases(
  rt: Rt,
  stale: StaleDraft[],
  a: GitHubApi | null,
) {
  const exec = (x: readonly string[]) =>
    rt.io.spawn(x, { cwd: rt.io.baseCwd, env: rt.io.env });
  if (a === null || stale.length === 0) {
    const code = await exec(rt.parsed.fullArgs);
    return code === 0 ? null : failSubmit(rt, code);
  }
  const p1Code = await exec(rt.parsed.phaseOneArgs);
  if (p1Code !== 0) {
    return failSubmit(rt, p1Code);
  }
  if ((await verifyRemoteHeads(rt)) === null) {
    return 1;
  }
  const names = stale.map((t) => t.branch);
  const shas = await resolveBranchShas(names, rt.io.runGit, rt.parsed.repoCwd);
  const timing = {
    now: rt.options.now ?? Date.now,
    sleep: rt.options.sleep ?? ((ms: number) => Bun.sleep(ms)),
    timeoutMs: rt.options.readyPollTimeoutMs ?? POLL_TIMEOUT_MS,
    writeStderr: rt.io.writeStderr,
  };
  for (const t of stale) {
    const target = { ...t, localSha: shas.get(t.branch) ?? t.localSha };
    if (!(await waitForPrHeadSha(target, a, timing))) {
      return 1;
    }
  }
  const p2Code = await exec(rt.parsed.phaseTwoArgs);
  return p2Code === 0 ? null : failSubmit(rt, p2Code);
}
async function runDrySubmit(
  rt: Rt,
  r: number | undefined,
  a: GitHubApi | null,
) {
  const { baseCwd: cwd, env } = rt.io;
  const code = await rt.io.spawn(rt.parsed.fullArgs, { cwd, env });
  const hasMeta = rt.parsed.title !== undefined || rt.parsed.body !== undefined;
  const ok =
    code === 0 &&
    a !== null &&
    hasMeta &&
    rt.parsed.scope === "branch" &&
    rt.anchor.branch !== null;
  if (!ok) {
    return code;
  }
  const { prNumber, pr } = await loadOpenBranchPr(rt, r, a);
  if (prNumber !== null && pr?.state === "open" && metaDiffers(pr, rt.parsed)) {
    rt.io.writeStderr(
      `INF toolkit: WOULD update PR #${String(prNumber)} metadata`,
    );
  }
  return 0;
}
export async function runGitSpiceSubmit(
  args: readonly string[],
  options: GitSpiceSubmitOptions = {},
): Promise<number> {
  const io = createBaseIo(options);
  const scan = scanSubmitCli(args, io.baseCwd);
  if (scan.scope === null || scan.hasHelp) {
    return io.spawn(args, { cwd: io.baseCwd, env: io.env });
  }
  const read = options.readTextFile ?? ((p: string) => Bun.file(p).text());
  const parsed = await materializeCli(scan, io.baseCwd, read, io.writeStderr);
  if (parsed === null) {
    return 2;
  }
  const { repoCwd: cwd } = parsed;
  const cfg = await readRepoConfigWithDefaults(cwd, io.env);
  if (!parsed.dryRun && !(await clearTrunkUpstreams(cfg, io, cwd))) {
    return 1;
  }
  const [preMap, anchor] = await Promise.all([
    readSpiceBranches(cwd, io.env),
    resolveAnchorBranch(parsed.branch, io.runGit, cwd),
  ]);
  const targets =
    anchor.branch === null
      ? []
      : computeScopeBranches(scan.scope, anchor.branch, cfg.trunk, preMap);
  const rt: Rt = { io, parsed, cfg, targets, anchor, options };
  const api = await buildGitHubApi(options, io.env, io.runGit, {
    cwd,
    remote: cfg.remote,
    hintBranch: anchor.branch,
  });
  if (parsed.dryRun) {
    const rec =
      anchor.branch === null ? undefined : preMap.get(anchor.branch)?.prNumber;
    return runDrySubmit(rt, rec, api);
  }
  const stale =
    api !== null && parsed.wantsReady
      ? await findStaleDrafts(rt, preMap, api)
      : [];
  const err = await executeLivePhases(rt, stale, api);
  if (err !== null) {
    return err;
  }
  const postMap = await verifyRemoteHeads(rt);
  if (postMap === null) {
    return 1;
  }
  const hasMeta =
    scan.scope === "branch" &&
    (parsed.title !== undefined || parsed.body !== undefined);
  return hasMeta ? syncOpenPrMetadata(rt, postMap, api) : 0;
}
