#!/usr/bin/env bun
import { appendFile, mkdir } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import path from "node:path";
import {
  fields,
  startDetachedToolkit,
  type Toolkit,
} from "./herdr_new_worktree_core.ts";
import {
  allocate,
  replenish,
  samePath,
  type PoolLocation,
} from "./herdr_worktree_pool_core.ts";
import { startMacBackground } from "./herdr_worktree_pool_launchd.ts";

const home = homedir();
const standardLocation: PoolLocation = {
  repo: path.join(home, "git", "monorepo"),
  root: path.join(home, ".herdr", "worktrees", "monorepo"),
};
const toolkitPath = path.join(home, ".local", "bin", "toolkit");
const toolkit: Toolkit = {
  platform: process.platform,
  startToolkit: (cwd, args) =>
    startDetachedToolkit(toolkitPath, cwd, args, {
      // `toolkit tend` records its own run in ~/.toolkit/tend/events.jsonl, so a
      // submission here can be matched to the pass recorded there.
      submitted: (job) => log(`dedupe submitted job=${job} path=${cwd}`),
    }),
};
const host = hostname().toLowerCase().split(".")[0] ?? "";
const macs = new Set([
  "macbook",
  "jerreds-macbook-pro",
  "karpathy",
  "mac-mini",
]);
const codingHost =
  process.platform === "darwin"
    ? macs.has(host)
    : process.platform === "win32" && host === "jerred-desktop";

function pooled(location: PoolLocation): boolean {
  return (
    codingHost &&
    samePath(location.repo, standardLocation.repo) &&
    samePath(location.root, standardLocation.root)
  );
}

function request(
  encoded: string | undefined,
): PoolLocation & { branch: string; generated: boolean } {
  if (encoded === undefined || !/^[\w-]+$/.test(encoded))
    throw new Error("Expected a base64url allocation request.");
  const value = fields(
    JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
    "Allocation request",
  );
  const repo = value.get("repo");
  const root = value.get("root");
  const branch = value.get("branch");
  const generated = value.get("generated");
  if (typeof repo !== "string" || !path.isAbsolute(repo))
    throw new TypeError("Expected an absolute repo path.");
  if (typeof root !== "string" || !path.isAbsolute(root))
    throw new TypeError("Expected an absolute worktree root path.");
  if (typeof branch !== "string" || typeof generated !== "boolean")
    throw new TypeError("Expected a branch and a generated boolean.");
  return { repo, root, branch, generated };
}

async function refillInBackground(): Promise<void> {
  if (process.platform === "win32") {
    // A process started through hc exec is in a Windows job. The scheduled
    // task keeps the refill alive after that job ends.
    const task = Bun.spawn(
      ["schtasks.exe", "/Run", "/TN", "HerdrWorktreePool"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, output, error] = await Promise.all([
      task.exited,
      new Response(task.stdout).text(),
      new Response(task.stderr).text(),
    ]);
    if (code !== 0) throw new Error((error === "" ? output : error).trim());
    return;
  }
  await startMacBackground(home, [
    process.execPath,
    import.meta.path,
    "--refill",
  ]);
}

async function log(message: string): Promise<void> {
  const directory = path.join(home, ".local", "state", "herdr-worktree");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await appendFile(
    path.join(directory, "pool.log"),
    `${new Date().toISOString()} ${message}\n`,
    { mode: 0o600 },
  );
}

async function main(): Promise<void> {
  const [action, encoded] = process.argv.slice(2);
  if (action === "--claim") {
    const input = request(encoded);
    const enabled = pooled(input);
    const result = await allocate(input, enabled, toolkit).finally(async () => {
      if (enabled)
        await refillInBackground().catch(async (error: unknown) => {
          const message = `Could not start background refill: ${error instanceof Error ? error.message : String(error)}`;
          await log(message).catch(() => {
            console.error(message);
          });
        });
    });
    console.log(JSON.stringify(result));
    return;
  }
  if (action !== "--seed" && action !== "--refill")
    throw new Error("Use --seed or --claim <base64url JSON>.");
  if (!codingHost) return;
  const count = await replenish(
    standardLocation,
    action === "--seed",
    toolkit,
  ).catch(async (error: unknown) => {
    await log(error instanceof Error ? error.message : String(error));
    throw error;
  });
  await log(`${String(count)} worktrees ready`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
