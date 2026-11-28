#!/usr/bin/env bun

import path from "node:path";

export const MISSING_LEFTHOOK_MESSAGE =
  "lefthook is not installed in this worktree — run 'bun install --frozen-lockfile' first";

const REPOSITORY_FALLBACK_ROOT = path.resolve(import.meta.dirname, "..", "..");

function defaultResolveGitToplevel(cwd: string): string | undefined {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    cwd,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) return undefined;
  const resolved = new TextDecoder().decode(result.stdout).trim();
  return resolved === "" ? undefined : resolved;
}

export type ResolveLefthookOptions = {
  readonly cwd?: string | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly resolveToplevel?: ((cwd: string) => string | undefined) | undefined;
  readonly fileExists?:
    ((candidate: string) => Promise<boolean> | boolean) | undefined;
  readonly which?: ((binary: string) => string | null) | undefined;
};

export async function resolveWorktreeLefthookBinary(
  options: ResolveLefthookOptions = {},
): Promise<string | undefined> {
  const cwd = options.cwd ?? process.cwd();
  const platform = options.platform ?? process.platform;
  const resolveToplevel = options.resolveToplevel ?? defaultResolveGitToplevel;
  const fileExists =
    options.fileExists ?? ((candidate: string) => Bun.file(candidate).exists());
  const which = options.which ?? ((name: string) => Bun.which(name));

  const toplevel = resolveToplevel(cwd) ?? REPOSITORY_FALLBACK_ROOT;
  const binDir = path.join(toplevel, "node_modules", ".bin");
  const candidates =
    platform === "win32"
      ? [
          path.join(binDir, "lefthook.exe"),
          path.join(binDir, "lefthook.cmd"),
          path.join(binDir, "lefthook"),
        ]
      : [path.join(binDir, "lefthook")];

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const fromPath = which("lefthook");
  return fromPath ?? undefined;
}

export type RunLefthookOptions = ResolveLefthookOptions & {
  readonly writeStderr?: ((message: string) => void) | undefined;
  readonly spawnBinary?:
    ((binary: string, args: readonly string[]) => Promise<number>) | undefined;
};

async function defaultSpawnBinary(
  binary: string,
  args: readonly string[],
): Promise<number> {
  const child = Bun.spawn([binary, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

export async function runLefthook(
  argv: readonly string[],
  options: RunLefthookOptions = {},
): Promise<number> {
  const binary = await resolveWorktreeLefthookBinary(options);
  if (binary === undefined) {
    // Lefthook's generated .git/hooks/* script probes `<lefthook> -h >/dev/null 2>&1`
    // before invoking `<lefthook> run <hook>`. Returning 0 on the bare `-h` probe
    // claims ownership of the hook invocation so missing-node_modules worktrees
    // never fall through to `go tool lefthook -h`, then fail fast on the real run.
    if (argv.length === 1 && argv[0] === "-h") {
      return 0;
    }
    const writeStderr =
      options.writeStderr ?? ((text: string) => process.stderr.write(text));
    writeStderr(`${MISSING_LEFTHOOK_MESSAGE}\n`);
    return 1;
  }

  const spawnBinary = options.spawnBinary ?? defaultSpawnBinary;
  return spawnBinary(binary, argv);
}

if (import.meta.main) {
  process.exitCode = await runLefthook(process.argv.slice(2));
}
