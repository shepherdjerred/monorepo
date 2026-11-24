#!/usr/bin/env bun
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const SpiceRepoFileSchema = z.looseObject({
  trunk: z.string().default("main"),
  remote: z.string().default("origin"),
});
const SpicePrSchema = z.looseObject({
  number: z.number().int().optional(),
  gqlID: z.string().optional(),
});
const SpiceBranchEntrySchema = z.looseObject({
  base: z
    .looseObject({ name: z.string().optional(), hash: z.string().optional() })
    .optional(),
  change: z
    .looseObject({
      github: z.looseObject({ pr: SpicePrSchema.optional() }).optional(),
    })
    .optional(),
});
const SpiceContItemSchema = z.looseObject({
  command: z.array(z.string()).default([]),
  branch: z.string(),
});
const SpiceContFileSchema = z.looseObject({
  continuations: z.array(SpiceContItemSchema).nullable().optional(),
});
const GqlNodeItemSchema = z.nullable(
  z.looseObject({
    state: z.string().optional(),
    headRefOid: z.string().optional(),
  }),
);
const GqlNodesPayloadSchema = z.looseObject({
  data: z
    .looseObject({ nodes: z.array(GqlNodeItemSchema) })
    .nullable()
    .optional(),
  errors: z.array(z.unknown()).optional(),
});

type BranchEntry = z.infer<typeof SpiceBranchEntrySchema>;
type ContEntry = { command: string[]; branch: string };
type SpiceSnapshot = {
  repo: { trunk: string; remote: string };
  branches: Map<string, BranchEntry>;
  continuations: ContEntry[];
};

function gitOut(
  cwd: string,
  args: readonly string[],
): { exit: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    env: Bun.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exit: proc.exitCode,
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
  };
}

function mustGit(cwd: string, args: readonly string[]): string {
  const res = gitOut(cwd, args);
  if (res.exit !== 0) {
    throw new Error(`shim git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout;
}

function readSpiceSnapshot(cwd: string): SpiceSnapshot {
  const repoShow = gitOut(cwd, ["show", "refs/spice/data:repo"]);
  const repo =
    repoShow.exit === 0
      ? SpiceRepoFileSchema.parse(JSON.parse(repoShow.stdout))
      : { trunk: "main", remote: "origin" };

  const branches = new Map<string, BranchEntry>();
  const lsTree = gitOut(cwd, [
    "ls-tree",
    "-r",
    "--name-only",
    "refs/spice/data",
    "--",
    "branches",
  ]);
  if (lsTree.exit === 0 && lsTree.stdout.length > 0) {
    for (const filePath of lsTree.stdout.split("\n")) {
      if (!filePath.startsWith("branches/")) continue;
      const branchName = filePath.slice("branches/".length);
      const blob = gitOut(cwd, ["show", `refs/spice/data:${filePath}`]);
      if (blob.exit === 0 && blob.stdout.length > 0) {
        branches.set(
          branchName,
          SpiceBranchEntrySchema.parse(JSON.parse(blob.stdout)),
        );
      }
    }
  }

  const contShow = gitOut(cwd, ["show", "refs/spice/data:rebase-continue"]);
  const parsedCont =
    contShow.exit === 0 && contShow.stdout.length > 0
      ? SpiceContFileSchema.parse(JSON.parse(contShow.stdout))
      : { continuations: [] };
  const continuations = (parsedCont.continuations ?? []).map((item) => ({
    command: [...item.command],
    branch: item.branch,
  }));

  return { repo, branches, continuations };
}

async function commitSpiceSnapshot(
  cwd: string,
  snap: SpiceSnapshot,
): Promise<void> {
  const stage = await mkdtemp(path.join(os.tmpdir(), "shim-spice-stage-"));
  try {
    mustGit(stage, ["init", "-q"]);
    mustGit(stage, ["config", "commit.gpgsign", "false"]);
    mustGit(stage, ["config", "user.name", "Shim"]);
    mustGit(stage, ["config", "user.email", "shim@example.com"]);
    await Bun.write(path.join(stage, "repo"), JSON.stringify(snap.repo));
    for (const [name, payload] of snap.branches) {
      const target = path.join(stage, "branches", ...name.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await Bun.write(target, JSON.stringify(payload));
    }
    if (snap.continuations.length > 0) {
      await Bun.write(
        path.join(stage, "rebase-continue"),
        JSON.stringify({ continuations: snap.continuations }),
      );
    }
    mustGit(stage, ["add", "."]);
    mustGit(stage, ["commit", "-q", "-m", "spice-data"]);
    const sha = mustGit(stage, ["rev-parse", "HEAD"]);
    mustGit(cwd, ["fetch", "-q", stage, sha]);
    mustGit(cwd, ["update-ref", "refs/spice/data", sha]);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

type ParsedShimCli = {
  cwd: string;
  positionals: string[];
  flags: Map<string, string>;
};

const VALUED_FLAGS = new Set(
  "--trunk --remote --base --branch -m --message -t --target --github-api-url --github-token".split(
    " ",
  ),
);

function consumeDirFlag(
  tok: string,
  next: string | undefined,
  cwd: string,
): { step: number; cwd: string } | null {
  if (tok === "-C" || tok === "--dir") {
    return {
      step: 2,
      cwd: next === undefined ? cwd : path.resolve(cwd, next),
    };
  }
  if (tok.startsWith("--dir=")) {
    return { step: 1, cwd: path.resolve(cwd, tok.slice(6)) };
  }
  if (tok.length > 2 && tok.startsWith("-C") && !tok.startsWith("--")) {
    const raw = tok.startsWith("-C=") ? tok.slice(3) : tok.slice(2);
    return { step: 1, cwd: path.resolve(cwd, raw) };
  }
  return null;
}

function consumeSingleShimArg(
  argv: readonly string[],
  idx: number,
  state: ParsedShimCli,
): number {
  const tok = argv[idx] ?? "";
  const next = argv[idx + 1];
  const dirMatch = consumeDirFlag(tok, next, state.cwd);
  if (dirMatch !== null) {
    state.cwd = dirMatch.cwd;
    return dirMatch.step;
  }
  if (next !== undefined && VALUED_FLAGS.has(tok)) {
    state.flags.set(tok, next);
    return 2;
  }
  if (tok.startsWith("--") && tok.includes("=")) {
    const eq = tok.indexOf("=");
    state.flags.set(tok.slice(0, eq), tok.slice(eq + 1));
    return 1;
  }
  if (tok.length > 2 && tok.startsWith("-t") && !tok.startsWith("--")) {
    state.flags.set("--target", tok.slice(2));
    return 1;
  }
  if (!tok.startsWith("-")) {
    state.positionals.push(tok);
  }
  return 1;
}

function parseShimCli(argv: readonly string[]): ParsedShimCli {
  const state: ParsedShimCli = {
    cwd: process.cwd(),
    positionals: [],
    flags: new Map<string, string>(),
  };
  let idx = 0;
  while (idx < argv.length) {
    idx += consumeSingleShimArg(argv, idx, state);
  }
  return state;
}

async function handleRepoSync(cwd: string): Promise<number> {
  const snap = readSpiceSnapshot(cwd);
  const apiBase = (
    Bun.env["GITHUB_API_URL"] ?? "https://api.github.com"
  ).replace(/\/+$/u, "");
  const token = Bun.env["GH_TOKEN"] ?? "";
  const trackedWithPr = [...snap.branches.entries()].flatMap(
    ([branch, meta]) => {
      const gqlId = meta.change?.github?.pr?.gqlID;
      return gqlId === undefined ? [] : [{ branch, gqlId }];
    },
  );
  if (trackedWithPr.length === 0) return 0;

  const res = await fetch(`${apiBase}/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token.length > 0 ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query:
        "query($ids:[ID!]!){nodes(ids:$ids){... on PullRequest{state,headRefOid}}}",
      variables: { ids: trackedWithPr.map((e) => e.gqlId) },
    }),
  });
  if (!res.ok) return 1;
  const parsed = GqlNodesPayloadSchema.parse(await res.json());
  if ((parsed.errors?.length ?? 0) > 0 || parsed.data == null) return 1;

  const currentBranch = gitOut(cwd, ["branch", "--show-current"]).stdout;
  for (const [idx, entry] of trackedWithPr.entries()) {
    const node = parsed.data.nodes[idx];
    if (node?.state === "MERGED") {
      snap.branches.delete(entry.branch);
      if (entry.branch !== currentBranch) {
        gitOut(cwd, ["branch", "-D", entry.branch]);
      }
    }
  }
  await commitSpiceSnapshot(cwd, snap);
  return 0;
}

async function handleBranchCreate(
  cli: ParsedShimCli,
  newBranch: string,
): Promise<number> {
  const snap = readSpiceSnapshot(cli.cwd);
  const curBranch = mustGit(cli.cwd, ["branch", "--show-current"]);
  const target = cli.flags.get("--target") ?? cli.flags.get("-t");
  const baseBranch = target ?? curBranch;

  if (baseBranch !== snap.repo.trunk && !snap.branches.has(baseBranch)) {
    console.error(`branch ${baseBranch} is not tracked`);
    return 1;
  }
  if (target === snap.repo.trunk) {
    const wtPorcelain = mustGit(cli.cwd, ["worktree", "list", "--porcelain"]);
    const toplevel = mustGit(cli.cwd, ["rev-parse", "--show-toplevel"]);
    for (const block of wtPorcelain.split(/\n{2,}/u)) {
      const wtLine = block.split("\n").find((l) => l.startsWith("worktree "));
      const brLine = block.split("\n").find((l) => l.startsWith("branch "));
      if (
        wtLine?.slice(9).trim() !== toplevel &&
        brLine === `branch refs/heads/${snap.repo.trunk}`
      ) {
        console.error(`${snap.repo.trunk} is checked out in another worktree`);
        return 1;
      }
    }
  }

  mustGit(cli.cwd, ["checkout", "-b", newBranch]);
  if (baseBranch === snap.repo.trunk) {
    mustGit(cli.cwd, ["config", `branch.${newBranch}.remote`, "."]);
    mustGit(cli.cwd, [
      "config",
      `branch.${newBranch}.merge`,
      `refs/heads/${baseBranch}`,
    ]);
  }
  const msg = cli.flags.get("-m") ?? cli.flags.get("--message");
  if (msg !== undefined) {
    mustGit(cli.cwd, ["commit", "-m", msg]);
  }
  const baseHash = mustGit(cli.cwd, ["rev-parse", baseBranch]);
  snap.branches.set(newBranch, { base: { name: baseBranch, hash: baseHash } });
  await commitSpiceSnapshot(cli.cwd, snap);
  return 0;
}

async function handleRestack(
  cli: ParsedShimCli,
  mode: "branch" | "upstack",
): Promise<number> {
  const snap = readSpiceSnapshot(cli.cwd);
  const branch =
    cli.flags.get("--branch") ?? mustGit(cli.cwd, ["branch", "--show-current"]);
  const baseName = snap.branches.get(branch)?.base?.name ?? snap.repo.trunk;
  const baseSha = mustGit(cli.cwd, ["rev-parse", baseName]);

  if (
    gitOut(cli.cwd, ["merge-base", "--is-ancestor", baseSha, branch]).exit === 0
  ) {
    const existing = snap.branches.get(branch) ?? {};
    snap.branches.set(branch, {
      ...existing,
      base: { name: baseName, hash: baseSha },
    });
    await commitSpiceSnapshot(cli.cwd, snap);
    return 0;
  }

  const rebase = gitOut(cli.cwd, ["rebase", baseName]);
  if (rebase.exit !== 0) {
    const upstackChildren =
      mode === "upstack"
        ? [...snap.branches.entries()]
            .filter(([, meta]) => meta.base?.name === branch)
            .map(([child]) => ({
              command: ["branch", "restack", "--branch", child],
              branch: child,
            }))
        : [];
    snap.continuations =
      upstackChildren.length > 0
        ? upstackChildren
        : [{ command: ["branch", "restack"], branch }];
    await commitSpiceSnapshot(cli.cwd, snap);
    return 1;
  }

  const existing = snap.branches.get(branch) ?? {};
  snap.branches.set(branch, {
    ...existing,
    base: { name: baseName, hash: baseSha },
  });
  await commitSpiceSnapshot(cli.cwd, snap);
  return 0;
}

async function handleRebaseContinue(cwd: string): Promise<number> {
  const cont = Bun.spawnSync(["git", "rebase", "--continue"], {
    cwd,
    env: { ...Bun.env, GIT_EDITOR: Bun.env["GIT_EDITOR"] ?? "true" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (cont.exitCode !== 0) return cont.exitCode;

  const snap = readSpiceSnapshot(cwd);
  const curBranch = mustGit(cwd, ["branch", "--show-current"]);
  const curBase = snap.branches.get(curBranch)?.base?.name ?? snap.repo.trunk;
  if (snap.branches.has(curBranch)) {
    snap.branches.set(curBranch, {
      ...snap.branches.get(curBranch),
      base: { name: curBase, hash: mustGit(cwd, ["rev-parse", curBase]) },
    });
  }

  const queued = [...snap.continuations];
  snap.continuations = [];
  for (const item of queued) {
    const prevMeta = snap.branches.get(item.branch);
    const itemBase = prevMeta?.base?.name ?? snap.repo.trunk;
    const oldBaseHash = prevMeta?.base?.hash;
    const rebaseArgs =
      oldBaseHash !== undefined && oldBaseHash.length > 0
        ? ["rebase", "--onto", itemBase, oldBaseHash, item.branch]
        : ["rebase", itemBase, item.branch];
    const rb = gitOut(cwd, rebaseArgs);
    if (rb.exit !== 0) return rb.exit;
    snap.branches.set(item.branch, {
      ...prevMeta,
      base: { name: itemBase, hash: mustGit(cwd, ["rev-parse", itemBase]) },
    });
  }
  await commitSpiceSnapshot(cwd, snap);
  return 0;
}

async function handleBranchTrack(
  cli: ParsedShimCli,
  branchArg: string,
  track: boolean,
): Promise<number> {
  const snap = readSpiceSnapshot(cli.cwd);
  const branch =
    branchArg.length > 0
      ? branchArg
      : mustGit(cli.cwd, ["branch", "--show-current"]);
  if (track) {
    const base = cli.flags.get("--base") ?? snap.repo.trunk;
    snap.branches.set(branch, {
      base: { name: base, hash: mustGit(cli.cwd, ["rev-parse", base]) },
    });
  } else {
    snap.branches.delete(branch);
  }
  await commitSpiceSnapshot(cli.cwd, snap);
  return 0;
}

const PAIR_ACTIONS = new Map(
  "repo:init,r:init,repo:i,r:i=repo-init|repo:sync,r:sync,repo:s,r:s=repo-sync|branch:track,b:track=branch-track|branch:untrack,b:untrack=branch-untrack|branch:create,b:create,branch:c,b:c=branch-create|branch:restack,b:restack=branch-restack|upstack:restack,us:restack=upstack-restack|rebase:continue,rb:continue,rebase:c,rb:c=rebase-continue"
    .split("|")
    .flatMap((group) => {
      const [keys = "", action = ""] = group.split("=");
      return keys.split(",").map((key) => [key, action] as const);
    }),
);

function resolveShimAction(positionals: readonly string[]): string {
  const [w0 = "", w1 = ""] = positionals;
  if (w0 === "rs" || w0 === "sync") return "repo-sync";
  if (w0 === "bc") return "bc-short";
  return w0 === "rbc"
    ? "rebase-continue"
    : (PAIR_ACTIONS.get(`${w0}:${w1}`) ?? "unknown");
}

async function main(): Promise<number> {
  const cli = parseShimCli(process.argv.slice(2));
  const [, w1 = "", w2 = ""] = cli.positionals;
  const action = resolveShimAction(cli.positionals);

  switch (action) {
    case "repo-init": {
      await commitSpiceSnapshot(cli.cwd, {
        repo: {
          trunk: cli.flags.get("--trunk") ?? "main",
          remote: cli.flags.get("--remote") ?? "origin",
        },
        branches: new Map(),
        continuations: [],
      });
      return 0;
    }
    case "repo-sync":
      return handleRepoSync(cli.cwd);
    case "branch-track":
      return handleBranchTrack(cli, w2, true);
    case "branch-untrack":
      return handleBranchTrack(cli, w2, false);
    case "bc-short":
      return handleBranchCreate(cli, w1);
    case "branch-create":
      return handleBranchCreate(cli, w2);
    case "branch-restack":
      return handleRestack(cli, "branch");
    case "upstack-restack":
      return handleRestack(cli, "upstack");
    case "rebase-continue":
      return handleRebaseContinue(cli.cwd);
    default:
      console.error(
        `git-spice-shim: unsupported argv: ${process.argv.slice(2).join(" ")}`,
      );
      return 2;
  }
}

process.exit(await main());
