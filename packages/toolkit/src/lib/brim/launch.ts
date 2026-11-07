/**
 * Agent launch: each Brim provider starts its agent wrapper from
 * `~/.local/share/agent-bin`, which owns credential scrubbing, the agent git
 * identity, and bypass flags. Brim adds none of that itself: it spawns the
 * wrapper directly (no shell) and passes extra args through verbatim.
 *
 * The wrapper is located by its fixed path, not PATH. Brim is often started
 * by a long-lived process (herdr-core) whose PATH was captured before the
 * wrappers were fronted, and a bare agent binary found there would run with
 * API keys and without bypass flags. A missing wrapper is an error.
 */
import os from "node:os";
import path from "node:path";

/** Brim provider id -> agent wrapper name in `~/.local/share/agent-bin`. */
export const PROVIDER_COMMANDS: Readonly<Record<string, string>> = {
  "claude-code": "claude",
  codex: "codex",
  antigravity: "agy",
  cursor: "cursor-agent",
  grok: "grok",
  kimi: "kimi",
  muse: "muse",
};

/** A provider that cannot be launched: unmapped, or its wrapper is missing. */
export class LaunchError extends Error {
  override name = "LaunchError";
}

export type Which = (command: string) => string | null;

export type Spawner = (argv: readonly string[]) => Promise<number>;

export type ResolvedLaunch = {
  readonly provider: string;
  readonly command: string;
  /** Absolute path of the executable `command` resolved to. */
  readonly path: string;
  readonly args: readonly string[];
};

export function providerCommand(provider: string): string {
  const command = PROVIDER_COMMANDS[provider];
  if (command === undefined) {
    throw new LaunchError(
      `No agent command is mapped for provider "${provider}". Known: ${Object.keys(PROVIDER_COMMANDS).join(", ")}.`,
    );
  }
  return command;
}

export function agentBinDirectory(home: string = os.homedir()): string {
  return path.join(home, ".local", "share", "agent-bin");
}

// Searches only the wrapper directory, never the inherited PATH.
const defaultWhich: Which = (command) =>
  Bun.which(command, { PATH: agentBinDirectory() });

/** Resolve a provider's agent wrapper. Throws LaunchError when it cannot run. */
export function resolveLaunch(
  provider: string,
  extraArgs: readonly string[],
  which: Which = defaultWhich,
): ResolvedLaunch {
  const command = providerCommand(provider);
  const wrapper = which(command);
  if (wrapper === null) {
    throw new LaunchError(
      `No agent wrapper "${command}" (for ${provider}) in ${agentBinDirectory()}. Apply the dotfiles agent-bin wrappers.`,
    );
  }
  return { provider, command, path: wrapper, args: [...extraArgs] };
}

const SAFE_DISPLAY_ARG = /^[\w@%+=:,./-]+$/u;

function displayArg(arg: string): string {
  return SAFE_DISPLAY_ARG.test(arg)
    ? arg
    : `'${arg.replaceAll("'", String.raw`'\''`)}'`;
}

/**
 * Human-readable command line for previews and `--dry-run`. Quoting here is
 * display-only; the spawn passes args verbatim.
 */
export function formatLaunch(launch: ResolvedLaunch): string {
  return [launch.path, ...launch.args].map((arg) => displayArg(arg)).join(" ");
}

export type LaunchPreview =
  | { readonly kind: "ready"; readonly line: string }
  | { readonly kind: "unavailable"; readonly message: string };

/** Picker preview for a provider: its command line, or why it cannot launch. */
export function previewLaunch(
  provider: string,
  which: Which = defaultWhich,
): LaunchPreview {
  try {
    return {
      kind: "ready",
      line: formatLaunch(resolveLaunch(provider, [], which)),
    };
  } catch (error: unknown) {
    if (error instanceof LaunchError) {
      return { kind: "unavailable", message: error.message };
    }
    throw error;
  }
}

const defaultSpawner: Spawner = async (argv) => {
  const proc = Bun.spawn([...argv], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
};

/** Spawn a resolved launch with inherited stdio; resolves to its exit code. */
export async function spawnLaunch(
  launch: ResolvedLaunch,
  spawn: Spawner = defaultSpawner,
): Promise<number> {
  return spawn([launch.path, ...launch.args]);
}
