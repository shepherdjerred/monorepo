import { chmod, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { exec } from "#evals/lib/exec.ts";

export type TaskEnvironment = {
  home: string;
  env: Record<string, string>;
};

/**
 * Prepares an isolated HOME for one task so parallel tasks never share a
 * daemon, sandboxes, journals or playtest runs:
 * - `bin/toolkit` execs this checkout's toolkit with the absolute bun binary
 *   (never the mise shim, which an isolated HOME does not trust);
 * - the Paper/plugin download cache and the renderer's Mojang asset cache are
 *   cloned (copy-on-write on APFS) from the real HOME when present;
 * - Docker keeps the real client config so the same daemon/context is used.
 */
export async function prepareTaskEnvironment(options: {
  taskDir: string;
  worktree: string;
  realHome: string;
  baseEnv: Record<string, string | undefined>;
}): Promise<TaskEnvironment> {
  const home = path.join(options.taskDir, "home");
  const bin = path.join(home, "bin");
  await mkdir(bin, { recursive: true });
  const wrapper = path.join(bin, "toolkit");
  await Bun.write(
    wrapper,
    `#!/bin/sh\nexec "${process.execPath}" run "${path.join(options.worktree, "packages", "toolkit", "src", "index.ts")}" "$@"\n`,
  );
  await chmod(wrapper, 0o755);

  for (const relative of [
    path.join(".toolkit", "mc", "cache"),
    path.join(".cache", "toolkit"),
  ]) {
    const source = path.join(options.realHome, relative);
    const isDirectory = await stat(source).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (!isDirectory) {
      // First run on this machine: the task downloads into its own cache.
      continue;
    }
    const target = path.join(home, relative);
    await mkdir(path.dirname(target), { recursive: true });
    const clone = await exec(["cp", "-cR", source, target], { cwd: home });
    if (clone.exitCode !== 0) {
      // Not an APFS volume: fall back to a plain copy.
      await exec(["cp", "-R", source, target], { cwd: home });
    }
  }

  const inherited: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.baseEnv)) {
    if (value !== undefined) {
      inherited[key] = value;
    }
  }
  return {
    home,
    env: {
      ...inherited,
      HOME: home,
      PATH: [bin, path.dirname(process.execPath), inherited["PATH"] ?? ""].join(
        ":",
      ),
      MISE_TRUSTED_CONFIG_PATHS: options.worktree,
      DOCKER_CONFIG: path.join(options.realHome, ".docker"),
    },
  };
}
