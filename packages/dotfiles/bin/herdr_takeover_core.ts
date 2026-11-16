// Detached session-takeover core: prepare a handoff bundle from the stalled
// terminal, optionally verify/sync git state and copy the handoff to another
// machine, open the replacement agent, then close the stalled pane/tab/space.

export type Launcher = "brim" | "profile";
export type PreparedSummary = { readonly title: string; readonly cwd: string; readonly handoffPath: string; readonly prompt: string };
export type Request = {
  readonly terminal: string; readonly space: string; readonly tab: string; readonly tabIndex: number;
  readonly tabName: string | null; readonly pane: string; readonly splitTab: boolean; readonly cwd: string;
  readonly provider: string; readonly machine: string | null; readonly targetMachine: string | null;
  readonly spaceTabCount: number; readonly spaceName: string | null; readonly targetRepoCandidates: readonly string[];
  readonly agentArgs: readonly string[]; readonly safe: boolean; readonly launcher: Launcher;
  readonly note: string | null; readonly prepared: PreparedSummary | null;
};
export type ExecResult = { readonly code: number; readonly stdout: string; readonly stderr: string };
export type MachineEnv = { readonly home: string; readonly windows: boolean };
export type SpaceInfo = { readonly id: string; readonly name: string; readonly folder: string | null; readonly machine: string | null };
export type NewTabResult = { readonly tab: string | null; readonly terminal: string };
export type NewSpaceResult = NewTabResult & { readonly space: string | null };
export type WorktreeEntry = { readonly path: string; readonly head: string; readonly branch: string | null };

export type Runtime = {
  readonly brim: (m: string | null, cwd: string, args: string[]) => Promise<ExecResult>;
  readonly git: (m: string | null, cwd: string, args: string[]) => Promise<ExecResult>;
  readonly machineEnv: (machine: string | null) => Promise<MachineEnv>;
  readonly dirExists: (m: string | null, dir: string, windows: boolean) => Promise<boolean>;
  readonly readHandoff: (m: string | null, path: string, windows: boolean) => Promise<string>;
  readonly writeTargetHandoff: (m: string | null, env: MachineEnv, fileName: string, markdown: string) => Promise<string>;
  readonly writeFallbackHandoff?: (m: string | null, terminal: string, md: string) => Promise<string | null>;
  readonly listSpaces: () => Promise<readonly SpaceInfo[]>;
  readonly newSpace: (args: Record<string, unknown>) => Promise<NewSpaceResult>;
  readonly selectSpace: (args: Record<string, unknown>) => Promise<void>;
  readonly closeSpace: (args: Record<string, unknown>) => Promise<void>;
  readonly newTab: (args: Record<string, unknown>) => Promise<NewTabResult>;
  readonly moveTab: (args: Record<string, unknown>) => Promise<void>;
  readonly closeTab: (args: Record<string, unknown>) => Promise<void>;
  readonly splitPane: (args: Record<string, unknown>) => Promise<string>;
  readonly closePane: (args: Record<string, unknown>) => Promise<void>;
  readonly hc: (args: string[]) => Promise<ExecResult>;
  readonly sleep: (ms: number) => Promise<void>;
};

export type Step = "preflight" | "preparing" | "syncing" | "opening" | "moving" | "closing" | "message";
export type Progress = { readonly step: Step; readonly title: string | null; readonly handoffPath: string | null };
export type Outcome = {
  readonly title: string; readonly cwd: string; readonly handoffPath: string; readonly terminal: string;
  readonly tab: string | null; readonly space: string | null; readonly targetMachine: string | null;
  readonly migrated: boolean; readonly splitTab: boolean; readonly messageSent: "argument" | "typed";
};

const PROFILE_COMMAND: Readonly<Record<string, string>> = {
  "claude-code": "claude", codex: "codex", antigravity: "agy", cursor: "cursor-agent", grok: "grok", kimi: "kimi", muse: "muse",
};
const PORCELAIN_ARGS = ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"];
const UNPUSHED_ARGS = ["--no-optional-locks", "rev-list", "-n1", "HEAD", "--not", "--remotes=origin"];
const REPO_PARENTS = ["git", "Repos", "src", "code", "projects", ""];

const badType = (msg: string): never => {
  throw new TypeError(msg);
};
export const fields = (v: unknown, what: string): Map<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? new Map<string, unknown>(Object.entries(v))
    : badType(`${what} must be a JSON object.`);
const text = (v: unknown, f: string): string =>
  typeof v === "string" && v.trim().length > 0 ? v : badType(`Request ${f} must be a non-empty string.`);
const nullableText = (v: unknown, f: string): string | null => (v === null || v === undefined ? null : text(v, f));
const positiveInt = (v: unknown, f: string): number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 1 ? v : badType(`Request ${f} must be a positive integer.`);
const boolField = (v: unknown, f: string): boolean => (typeof v === "boolean" ? v : badType(`Request ${f} must be a boolean.`));
const strings = (v: unknown, f: string): string[] =>
  Array.isArray(v)
    ? v.map((x: unknown) => (typeof x === "string" ? x : badType(`Request ${f} must be a string array.`)))
    : badType(`Request ${f} must be a string array.`);

function parsePrepared(value: unknown): PreparedSummary | null {
  if (value === null || value === undefined) return null;
  const p = fields(value, "Request prepared");
  const hp = p.get("handoffPath");
  if (typeof hp !== "string") throw new TypeError("Request prepared.handoffPath must be a string.");
  return { title: text(p.get("title"), "prepared.title").trim(), cwd: text(p.get("cwd"), "prepared.cwd"), handoffPath: hp, prompt: text(p.get("prompt"), "prepared.prompt") };
}

export function parseRequest(json: string): Request {
  const r = fields(JSON.parse(json), "Request");
  const launcher = r.get("launcher");
  if (launcher !== "brim" && launcher !== "profile") throw new TypeError('Request launcher must be "brim" or "profile".');
  const rawNote = nullableText(r.get("note"), "note");
  const machine = nullableText(r.get("machine"), "machine");
  const [rawCount, rawCands] = [r.get("spaceTabCount"), r.get("targetRepoCandidates")];
  return {
    terminal: text(r.get("terminal"), "terminal"),
    space: text(r.get("space"), "space"),
    tab: text(r.get("tab"), "tab"),
    tabIndex: positiveInt(r.get("tabIndex"), "tabIndex"),
    tabName: nullableText(r.get("tabName"), "tabName"),
    pane: text(r.get("pane"), "pane"),
    splitTab: boolField(r.get("splitTab"), "splitTab"),
    cwd: text(r.get("cwd"), "cwd"),
    provider: text(r.get("provider"), "provider"),
    machine,
    targetMachine: r.has("targetMachine") ? nullableText(r.get("targetMachine"), "targetMachine") : machine,
    spaceTabCount: rawCount === undefined ? 2 : positiveInt(rawCount, "spaceTabCount"),
    spaceName: r.has("spaceName") ? nullableText(r.get("spaceName"), "spaceName") : null,
    targetRepoCandidates: rawCands === undefined ? [] : strings(rawCands, "targetRepoCandidates"),
    agentArgs: strings(r.get("agentArgs"), "agentArgs"),
    safe: boolField(r.get("safe"), "safe"),
    launcher,
    note: rawNote === null ? null : rawNote.trim(),
    prepared: parsePrepared(r.get("prepared")),
  };
}

export const isCrossMachine = (request: Request): boolean => request.targetMachine !== request.machine;

export function bareTerminal(terminal: string, machine: string | null): string {
  if (machine !== null && terminal.startsWith(`${machine}/`)) return terminal.slice(machine.length + 1);
  const slash = terminal.indexOf("/");
  return machine !== null && slash > 0 ? terminal.slice(slash + 1) : terminal;
}

export const qualifiedTerminal = (terminal: string, machine: string | null): string =>
  machine === null || terminal.includes("/") ? terminal : `${machine}/${terminal}`;

export function shortTitle(title: string): string {
  const line = title.split("\n").map((p) => p.replaceAll(/\s+/g, " ").trim()).find(Boolean) ?? "";
  if (line === "") return "Takeover";
  return line.length <= 48 ? line : `${line.slice(0, 47).trimEnd()}…`;
}

export function normPath(value: string): string {
  const fwd = value.replaceAll("\\", "/");
  const stripped = fwd.replace(/\/+$/u, "");
  return stripped === "" && fwd.startsWith("/") ? "/" : stripped;
}

const samePath = (a: string, b: string, win: boolean): boolean =>
  win ? normPath(a).toLowerCase() === normPath(b).toLowerCase() : normPath(a) === normPath(b);

const stripGitDir = (commonDir: string): string => {
  const n = normPath(commonDir);
  return n.toLowerCase().endsWith("/.git") ? normPath(n.slice(0, -5)) : n;
};

function relativeSubpath(top: string, cwd: string, win: boolean): string {
  const [nt, nc] = [normPath(top), normPath(cwd)];
  if (samePath(nt, nc, win)) return "";
  const pfx = `${nt}/`;
  return (win ? nc.toLowerCase().startsWith(pfx.toLowerCase()) : nc.startsWith(pfx)) ? nc.slice(pfx.length) : "";
}

const lastSeg = (p: string, fallback: string) => p.split("/").findLast((s) => s.length > 0) ?? fallback;
const stripHostAuth = (h: string) => (h.includes("@") ? h.slice(h.lastIndexOf("@") + 1) : h).replace(/:\d+$/u, "");

export function sanitizeWorktreeSlug(branch: string): string {
  const cleaned = branch.trim().replaceAll(/[^\w.-]+/gu, "-").replaceAll(/-+/gu, "-").replaceAll(/^[.-]+|[.-]+$/gu, "");
  return cleaned === "" ? "worktree" : cleaned;
}

export function normalizeGitRemoteUrl(raw: string): string {
  let s = raw.trim();
  const proto = s.indexOf("://");
  if (proto > 0) {
    const rest = s.slice(proto + 3);
    const slash = rest.indexOf("/");
    s = slash === -1 ? stripHostAuth(rest) : `${stripHostAuth(rest.slice(0, slash))}/${rest.slice(slash + 1)}`;
  } else {
    const [colon, slash] = [s.indexOf(":"), s.indexOf("/")];
    if (colon > 1 && (slash === -1 || colon < slash))
      s = `${stripHostAuth(s.slice(0, colon))}/${s.slice(colon + 1).replace(/^\/+/u, "")}`;
  }
  return s.replace(/\/+$/u, "").replace(/\.git$/iu, "").replace(/\/+$/u, "").toLowerCase();
}

export function parseWorktreeList(stdout: string): WorktreeEntry[] {
  const out: { path: string; head: string; branch: string | null }[] = [];
  let cur: { path: string; head: string; branch: string | null } | null = null;
  for (const line of stdout.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) out.push((cur = { path: line.slice(9).trim(), head: "", branch: null }));
    else if (cur !== null && line.startsWith("HEAD ")) cur.head = line.slice(5).trim();
    else if (cur !== null && line.startsWith("branch ")) cur.branch = line.slice(7).trim().replace(/^refs\/heads\//u, "");
  }
  return out.filter((e) => e.path.length > 0);
}

function agentCommand(req: Request, args: string[]): string[] {
  if (req.launcher === "brim")
    return [...(req.safe ? ["env", "AGENT_SAFE=1"] : []), "brim", "--provider", req.provider, "--", ...args];
  const cmd = PROFILE_COMMAND[req.provider];
  if (cmd === undefined) throw new Error(`No PowerShell wrapper for provider ${req.provider}.`);
  return [...(req.safe ? ["agent-safe"] : []), cmd, ...args];
}

export function launch(
  req: Request,
  prepared: { readonly title: string; readonly prompt: string },
): { argv: string[]; task: string | null; typed: boolean; tabTitle: string } {
  const tabTitle = req.tabName ?? shortTitle(prepared.title);
  const extra = [...req.agentArgs];
  if (req.provider === "claude-code") extra.push("--name", tabTitle);
  if (req.provider === "antigravity") extra.push("-i", prepared.prompt);
  const typed = req.provider === "kimi";
  const asTask = req.provider !== "antigravity" && !typed;
  const inline = req.splitTab && !isCrossMachine(req);
  const tail = inline ? (asTask ? ["--", prepared.prompt] : []) : asTask ? ["--"] : [];
  return { argv: agentCommand(req, [...extra, ...tail]), task: !inline && asTask ? prepared.prompt : null, typed, tabTitle };
}

const firstLine = (res: ExecResult, fallback: string): string =>
  ((res.stderr.trim() === "" ? res.stdout : res.stderr).trim().split("\n")[0] ?? "") || fallback;

export function parsePreparedTakeover(stdout: string, fallbackCwd: string): PreparedSummary {
  const obj = fields(JSON.parse(stdout), "PreparedTakeover");
  const prompt = obj.get("prompt");
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new TypeError("brim takeover returned an empty prompt.");
  const [t, c, h] = [obj.get("title"), obj.get("cwd"), obj.get("handoffPath")];
  const title = typeof t === "string" && t.trim().length > 0 ? t.trim() : "Session takeover";
  return { title, cwd: typeof c === "string" && c.trim().length > 0 ? c : fallbackCwd, handoffPath: typeof h === "string" ? h : "", prompt };
}

async function prepareFallbackFromScreen(req: Request, rt: Runtime): Promise<PreparedSummary> {
  const target = qualifiedTerminal(req.terminal, req.machine);
  const read = await rt.hc(["read", "--lines", "200", target]);
  if (read.code !== 0) throw new Error(`Could not read terminal ${target}: ${firstLine(read, "hc read failed")}`);
  const screen = read.stdout.trim();
  const noteMd = req.note === null ? "" : `\n## User Note\n\n${req.note}\n`;
  const md = `# Session Handoff (${target})\n\n- Working directory: \`${req.cwd}\`\n${noteMd}\n## Recent Terminal Output\n\n\`\`\`text\n${screen || "(terminal screen was empty)"}\n\`\`\`\n`;
  const hp = (await rt.writeFallbackHandoff?.(req.machine, bareTerminal(req.terminal, req.machine), md)) ?? "";
  const excerpt = screen.split("\n").slice(-80).join("\n").trim() || "(empty)";
  const prompt = [
    "Continue this coding session seamlessly from another agent that stalled or hit a usage limit.",
    `Working directory: ${req.cwd}`,
    ...(hp === "" ? [] : [`Full captured terminal handoff file: ${hp}`]),
    ...(req.note === null ? [] : ["", "User handoff note:", req.note]),
    `\nRecent terminal output from the previous session:\n\`\`\`text\n${excerpt}\n\`\`\`\n\nInspect the current git status/diff in this directory (and the handoff file if needed) to verify state, then continue the work.`,
  ].join("\n");
  return { title: req.tabName ?? "Session takeover", cwd: req.cwd, handoffPath: hp, prompt };
}

async function prepareHandoff(req: Request, rt: Runtime, srcLauncher = req.launcher): Promise<PreparedSummary> {
  if (req.prepared !== null) {
    return req.note === null || req.prepared.prompt.includes(req.note)
      ? req.prepared
      : { ...req.prepared, prompt: `${req.prepared.prompt}\n\nAdditional user handoff note:\n${req.note}` };
  }
  if (srcLauncher === "profile") return prepareFallbackFromScreen(req, rt);
  const args = ["takeover", "--prepare", "--json", "--terminal", bareTerminal(req.terminal, req.machine)];
  if (req.note !== null) args.push("--note", req.note);
  const res = await rt.brim(req.machine, req.cwd, args);
  if (res.code !== 0) throw new Error(firstLine(res, "brim takeover --prepare failed."));
  return parsePreparedTakeover(res.stdout, req.cwd);
}

async function typeFirstMessage(rt: Runtime, terminal: string, message: string): Promise<void> {
  let state: string | null = null;
  for (let i = 0; i < 120; i++) {
    const res = await rt.hc(["get", terminal, "--json"]);
    const status = res.code === 0 ? fields(JSON.parse(res.stdout), "hc get").get("status") : null;
    const raw = status === null || status === undefined ? null : fields(status, "hc status").get("state");
    state = typeof raw === "string" ? raw : null;
    if (state === "idle") break;
    await rt.sleep(500);
  }
  if (state !== "idle")
    throw new Error(`The replacement tab is open, but the agent never became idle (last: ${state ?? "unknown"}); its handoff prompt wasn't sent.`);
  const sent = await rt.hc(["send", terminal, message]);
  if (sent.code !== 0)
    throw new Error(`The replacement tab is open, but its handoff prompt wasn't sent: ${firstLine(sent, "hc send failed")}`);
}

const makeCtx = (req: Request, rt: Runtime, srcEnv: MachineEnv, dstEnv: MachineEnv) => {
  const checked = async (m: string | null, cwd: string, args: string[], err?: string) => {
    const res = await rt.git(m, cwd, args);
    if (err !== undefined && res.code !== 0) throw new Error(firstLine(res, err));
    return res;
  };
  return {
    req, rt, srcEnv, dstEnv,
    srcGit: (args: string[], err?: string) => checked(req.machine, req.cwd, args, err),
    dstGit: (cwd: string, args: string[], err?: string) => checked(req.targetMachine, cwd, args, err),
  };
};
type Ctx = ReturnType<typeof makeCtx>;

async function preflightGit(ctx: Ctx, rawTop: string, rawCommon: string) {
  const dirty = await ctx.srcGit(PORCELAIN_ARGS, "git status failed on source machine.");
  if (dirty.stdout.trim() !== "")
    throw new Error("Source checkout has uncommitted or untracked changes; commit and push to origin before moving to another machine.");
  const headRes = await ctx.srcGit(["rev-parse", "HEAD"], "Could not resolve HEAD commit.");
  const headSha = headRes.stdout.trim();
  const sym = await ctx.srcGit(["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const branch = sym.code === 0 && sym.stdout.trim() !== "" ? sym.stdout.trim() : null;
  const originRes = await ctx.srcGit(["remote", "get-url", "origin"]);
  const originUrl = originRes.stdout.trim();
  if (originUrl === "" || originRes.code !== 0) throw new Error("Source repository has no 'origin' remote configured.");
  const unpushed = await ctx.srcGit(UNPUSHED_ARGS, "Failed checking unpushed commits.");
  if (unpushed.stdout.trim() !== "") {
    if (branch === null)
      throw new Error("Detached HEAD has unpushed commits not on origin; push to origin before moving to another machine.");
    const ls = await ctx.srcGit(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
    const remoteSha = ls.stdout.trim().split(/\s+/u)[0] ?? "";
    if (remoteSha !== headSha || ls.code !== 0)
      throw new Error(`Branch "${branch}" has unpushed commits not on origin; push to origin before moving to another machine.`);
  }
  const [sourceTop, sourceMain] = [normPath(rawTop), stripGitDir(rawCommon)];
  const isLinkedWorktree = sourceTop.toLowerCase() !== sourceMain.toLowerCase();
  const worktreeSlug = isLinkedWorktree ? lastSeg(sourceTop, "worktree") : branch === null ? headSha.slice(0, 12) : sanitizeWorktreeSlug(branch);
  return { kind: "git" as const, headSha, branch, originUrl, isLinkedWorktree, repoName: lastSeg(sourceMain, "repo"), subpath: relativeSubpath(sourceTop, ctx.req.cwd, ctx.srcEnv.windows), worktreeSlug };
}
type GitInfo = Awaited<ReturnType<typeof preflightGit>>;

async function preflightSource(ctx: Ctx) {
  const top = await ctx.srcGit(["rev-parse", "--show-toplevel"]);
  const common = top.code === 0 ? await ctx.srcGit(["rev-parse", "--path-format=absolute", "--git-common-dir"]) : top;
  if (top.code === 0 && common.code === 0 && top.stdout.trim() !== "" && common.stdout.trim() !== "")
    return preflightGit(ctx, top.stdout.trim(), common.stdout.trim());
  const [nc, sh, dh] = [normPath(ctx.req.cwd), normPath(ctx.srcEnv.home), normPath(ctx.dstEnv.home)];
  const sub = relativeSubpath(sh, nc, ctx.srcEnv.windows);
  const mappedCwd = samePath(nc, sh, ctx.srcEnv.windows) ? dh : sub.length > 0 ? `${dh}/${sub}` : nc;
  if (!(await ctx.rt.dirExists(ctx.req.targetMachine, mappedCwd, ctx.dstEnv.windows)))
    throw new Error(`Folder "${ctx.req.cwd}" is not a git repository and does not exist on ${ctx.req.targetMachine ?? "this computer"}.`);
  return { kind: "folder" as const, mappedCwd };
}

async function findTargetRepoMain(ctx: Ctx, g: GitInfo): Promise<string> {
  const home = normPath(ctx.dstEnv.home);
  const defaults = REPO_PARENTS.map((d) => (d === "" ? `${home}/${g.repoName}` : `${home}/${d}/${g.repoName}`));
  const seen = new Set<string>();
  const wanted = normalizeGitRemoteUrl(g.originUrl);
  for (const raw of [...ctx.req.targetRepoCandidates, ...defaults]) {
    const cand = normPath(raw.trim());
    const key = ctx.dstEnv.windows ? cand.toLowerCase() : cand;
    if (cand === "" || seen.has(key)) continue;
    seen.add(key);
    if (!(await ctx.rt.dirExists(ctx.req.targetMachine, cand, ctx.dstEnv.windows))) continue;
    const common = await ctx.dstGit(cand, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (common.code !== 0 || common.stdout.trim() === "") continue;
    const main = stripGitDir(common.stdout.trim());
    const origin = await ctx.dstGit(main, ["remote", "get-url", "origin"]);
    if (origin.code === 0 && normalizeGitRemoteUrl(origin.stdout.trim()) === wanted) return main;
  }
  throw new Error(`Repository "${g.repoName}" (${g.originUrl}) was not found on ${ctx.req.targetMachine ?? "this computer"}.`);
}

async function tryReuseMain(ctx: Ctx, main: string, entries: readonly WorktreeEntry[], g: GitInfo): Promise<string | null> {
  if (g.isLinkedWorktree) return null;
  const entry = entries.find((e) => samePath(e.path, main, ctx.dstEnv.windows));
  const clean = await ctx.dstGit(main, PORCELAIN_ARGS);
  if (entry === undefined || clean.code !== 0 || clean.stdout.trim() !== "") return null;
  if (entry.head === g.headSha) return normPath(main);
  if (g.branch === null || entry.branch !== g.branch) return null;
  const ff = await ctx.dstGit(main, ["merge", "--ff-only", g.headSha]);
  return ff.code === 0 ? normPath(main) : null;
}

async function reuseExistingWt(ctx: Ctx, wt: WorktreeEntry, g: GitInfo): Promise<string> {
  const label = ctx.req.targetMachine ?? "this computer";
  const st = await ctx.dstGit(wt.path, PORCELAIN_ARGS);
  if (st.code !== 0 || st.stdout.trim() !== "")
    throw new Error(`Target worktree ${wt.path} on ${label} has uncommitted changes.`);
  if (wt.head !== g.headSha) {
    const unp = await ctx.dstGit(wt.path, UNPUSHED_ARGS);
    if (unp.code !== 0 || unp.stdout.trim() !== "")
      throw new Error(`Target worktree ${wt.path} on ${label} has unpushed commits.`);
    const args = g.branch === null ? ["checkout", "--detach", g.headSha] : ["checkout", "-B", g.branch, g.headSha];
    await ctx.dstGit(wt.path, args, `git checkout failed in ${wt.path}.`);
  }
  return normPath(wt.path);
}

async function addFreshWt(ctx: Ctx, main: string, baseWt: string, g: GitInfo): Promise<string> {
  for (let n = 1; n <= 50; n++) {
    const cand = n === 1 ? baseWt : `${baseWt}-${String(n)}`;
    if (!(await ctx.rt.dirExists(ctx.req.targetMachine, cand, ctx.dstEnv.windows))) {
      const add = g.branch === null ? ["worktree", "add", "--detach", cand, g.headSha] : ["worktree", "add", "-B", g.branch, cand, g.headSha];
      await ctx.dstGit(main, add, "git worktree add failed on target machine.");
      return normPath(cand);
    }
  }
  throw new Error(`No free worktree directory available under ${baseWt}.`);
}

async function syncTargetRepo(ctx: Ctx, g: GitInfo): Promise<{ top: string; cwd: string }> {
  const main = await findTargetRepoMain(ctx, g);
  await ctx.dstGit(main, ["fetch", "--prune", "origin"], "git fetch origin failed on target machine.");
  const cat = await ctx.dstGit(main, ["cat-file", "-e", `${g.headSha}^{commit}`]);
  if (cat.code !== 0)
    throw new Error(`Commit ${g.headSha.slice(0, 10)} was not found on origin after git fetch; push your branch to origin first.`);
  const wtOut = await ctx.dstGit(main, ["worktree", "list", "--porcelain"], "git worktree list failed.");
  const entries = parseWorktreeList(wtOut.stdout);
  const reusedMain = await tryReuseMain(ctx, main, entries, g);
  if (reusedMain !== null) return { top: reusedMain, cwd: g.subpath ? `${reusedMain}/${g.subpath}` : reusedMain };
  const baseWt = `${normPath(ctx.dstEnv.home)}/.herdr/worktrees/${g.repoName}/${g.worktreeSlug}`;
  const pool = g.isLinkedWorktree ? entries.filter((e) => !samePath(e.path, main, ctx.dstEnv.windows)) : entries;
  const existing = pool.find((e) => (g.branch !== null && e.branch === g.branch) || samePath(e.path, baseWt, ctx.dstEnv.windows));
  const top = existing === undefined ? await addFreshWt(ctx, main, baseWt, g) : await reuseExistingWt(ctx, existing, g);
  return { top, cwd: g.subpath ? `${top}/${g.subpath}` : top };
}

async function openOnTarget(ctx: Ctx, target: { top: string; cwd: string }, launched: ReturnType<typeof launch>): Promise<NewSpaceResult> {
  const spaces = await ctx.rt.listSpaces();
  const open = spaces.find(
    (s) => (s.machine ?? null) === ctx.req.targetMachine && s.folder !== null && samePath(s.folder, target.top, ctx.dstEnv.windows),
  );
  const taskOpt = launched.task === null ? {} : { task: launched.task };
  if (open === undefined) {
    return ctx.rt.newSpace({
      machine: ctx.req.targetMachine ?? "", name: ctx.req.spaceName ?? launched.tabTitle,
      folder: target.cwd, tab: launched.tabTitle, argv: launched.argv, ...taskOpt, focus: true,
    });
  }
  const tab = await ctx.rt.newTab({ space: open.id, folder: target.cwd, name: launched.tabTitle, argv: launched.argv, ...taskOpt, focus: true });
  await ctx.rt.selectSpace({ id: open.id });
  return { space: open.id, tab: tab.tab, terminal: tab.terminal };
}

type Reporter = (step: Step, title: string | null, handoff: string | null) => void | Promise<void>;

async function migrateAcrossMachines(req: Request, rt: Runtime, report: Reporter): Promise<Outcome> {
  await report("preflight", null, null);
  const ctx = makeCtx(req, rt, await rt.machineEnv(req.machine), await rt.machineEnv(req.targetMachine));
  const pre = await preflightSource(ctx);
  await report("preparing", null, null);
  const prepared = await prepareHandoff(req, rt, ctx.srcEnv.windows ? "profile" : "brim");
  const md = prepared.handoffPath ? await rt.readHandoff(req.machine, prepared.handoffPath, ctx.srcEnv.windows) : prepared.prompt;
  const th = await rt.writeTargetHandoff(req.targetMachine, ctx.dstEnv, lastSeg(prepared.handoffPath.replaceAll("\\", "/"), "handoff.md"), md);
  const rewritten = prepared.handoffPath ? prepared.prompt.replaceAll(prepared.handoffPath, th) : prepared.prompt;
  const finalPrompt = `${rewritten}\n(Session migrated from ${req.machine ?? "local machine"} to ${req.targetMachine ?? "local machine"}; any raw source transcript path above was on the source machine — read ${th}.)`;
  const target = pre.kind === "git" ? (await report("syncing", prepared.title, th), await syncTargetRepo(ctx, pre)) : { top: pre.mappedCwd, cwd: pre.mappedCwd };
  await report("opening", prepared.title, th);
  const launched = launch(req, { title: prepared.title, prompt: finalPrompt });
  const created = await openOnTarget(ctx, target, launched);
  if (launched.typed) {
    await report("message", prepared.title, th);
    await typeFirstMessage(rt, qualifiedTerminal(created.terminal, req.targetMachine), finalPrompt);
  }
  await report("closing", prepared.title, th);
  if (req.splitTab) await rt.closePane({ pane: req.pane });
  else if (req.spaceTabCount <= 1) await rt.closeSpace({ id: req.space, confirmed: true });
  else await rt.closeTab({ id: req.tab, confirmed: true });
  return {
    title: launched.tabTitle, cwd: target.cwd, handoffPath: th, terminal: created.terminal,
    tab: created.tab, space: created.space, targetMachine: req.targetMachine, migrated: true,
    splitTab: req.splitTab, messageSent: launched.typed ? "typed" : "argument",
  };
}

export async function takeOverSession(req: Request, rt: Runtime, progress?: (update: Progress) => void | Promise<void>): Promise<Outcome> {
  const report: Reporter = (step, title, handoffPath) => progress?.({ step, title, handoffPath });
  if (isCrossMachine(req)) return migrateAcrossMachines(req, rt, report);
  await report("preparing", null, null);
  const prepared = await prepareHandoff(req, rt);
  await report("opening", prepared.title, prepared.handoffPath);
  const { argv, task, typed, tabTitle } = launch(req, prepared);
  let opened: NewTabResult;
  if (req.splitTab) {
    const terminal = await rt.splitPane({ direction: "right", pane: req.pane, argv });
    opened = { tab: null, terminal };
    await report("closing", prepared.title, prepared.handoffPath);
    await rt.closePane({ pane: req.pane });
  } else {
    opened = await rt.newTab({ space: req.space, folder: prepared.cwd, name: tabTitle, argv, ...(task === null ? {} : { task }) });
    await report("moving", prepared.title, prepared.handoffPath);
    await rt.moveTab({ ...(opened.tab === null ? {} : { id: opened.tab }), index: req.tabIndex });
    await report("closing", prepared.title, prepared.handoffPath);
    await rt.closeTab({ id: req.tab, confirmed: true });
  }
  if (typed) {
    await report("message", prepared.title, prepared.handoffPath);
    await typeFirstMessage(rt, qualifiedTerminal(opened.terminal, req.machine), prepared.prompt);
  }
  return {
    title: tabTitle, cwd: prepared.cwd, handoffPath: prepared.handoffPath, terminal: opened.terminal,
    tab: opened.tab, space: req.space, targetMachine: req.machine, migrated: false,
    splitTab: req.splitTab, messageSent: typed ? "typed" : "argument",
  };
}
