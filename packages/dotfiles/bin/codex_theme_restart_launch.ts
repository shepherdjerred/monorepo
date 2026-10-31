import type { Runtime } from "./codex_theme_restart_terminal.ts";

export const uuid =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("Expected a nonempty argument");
  return value;
}

const valueFlags = new Set([
  "-c",
  "--config",
  "--enable",
  "--disable",
  "--remote",
  "--remote-auth-token-env",
  "--code-mode-host",
  "--local-provider",
  "-m",
  "--model",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "-a",
  "--ask-for-approval",
  "--add-dir",
]);
const booleanFlags = new Set([
  "--oss",
  "--strict-config",
  "--approve-for-me",
  "--search",
  "--no-alt-screen",
  "--no-daemon",
]);
export const bypassFlags = new Set([
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
]);
const discardedValues = new Set(["-C", "--cd", "-i", "--image"]);
const discardedFlags = new Set([
  "--worktree",
  "--last",
  "--all",
  "--include-non-interactive",
]);

function nativeOption(
  argv: readonly string[],
  index: number,
): { retained: string[]; consumed: number } {
  const argument = string(argv[index]);
  const flag = string(argument.split("=")[0]);
  const inline = argument.includes("=");
  if (valueFlags.has(flag) || discardedValues.has(flag)) {
    const value = inline
      ? argument.slice(argument.indexOf("=") + 1)
      : argv[index + 1];
    if (value === undefined) throw new Error("Missing Codex option value");
    return {
      retained:
        valueFlags.has(flag) &&
        !(
          (flag === "-c" || flag === "--config") &&
          /^\s*tui\.(?:theme|resume_cwd)\s*=/.test(value)
        )
          ? [flag, value]
          : [],
      consumed: inline ? 1 : 2,
    };
  }
  if (!inline && (booleanFlags.has(flag) || bypassFlags.has(flag)))
    return { retained: [flag], consumed: 1 };
  if (!inline && discardedFlags.has(flag)) return { retained: [], consumed: 1 };
  throw new Error("Unsupported Codex launch option; terminal left running");
}

const otherCommands = new Set([
  "agents",
  "exec",
  "review",
  "login",
  "logout",
  "mcp",
  "plugin",
  "app-server",
  "remote-control",
  "app",
  "completion",
  "update",
  "doctor",
  "sandbox",
  "debug",
  "apply",
  "queue",
  "archive",
  "delete",
  "migrate-rollouts",
  "unarchive",
  "fork",
  "cloud",
  "exec-server",
  "features",
  "help",
]);

function validatePositionals(positionals: readonly string[]): void {
  const first = positionals[0];
  if (first === "resume") {
    if (positionals.length > 3) throw new Error("Unexpected resume arguments");
    return;
  }
  if (
    positionals.length > 1 ||
    (first !== undefined && otherCommands.has(first))
  )
    throw new Error("Unsupported Codex launch command");
}

function launchOptions(argv: readonly string[]): string[] {
  const executable = argv[0]?.split("/").at(-1);
  if (executable !== "codex")
    throw new Error("Foreground process is not Codex");
  const retained: string[] = [];
  const positionals: string[] = [];
  let literal = false;
  for (let index = 1; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === undefined) throw new Error("Missing process argument");
    if (!literal && argument === "--") {
      literal = true;
      continue;
    }
    if (literal || !argument.startsWith("-")) {
      positionals.push(argument);
      continue;
    }
    const option = nativeOption(argv, index);
    retained.push(...option.retained);
    index += option.consumed - 1;
  }
  // Only the interactive entrypoint and `resume` are supported. Other native commands
  // must not accidentally be turned into a continuation of an unrelated thread.
  validatePositionals(positionals);
  return retained;
}

export function validateLaunchArguments(argv: readonly string[]): void {
  launchOptions(argv);
}

/** Keep launch policy, never replay a prompt, fork, image attachment, or worktree creation. */
export function resumeArguments(
  argv: readonly string[],
  thread: string,
): string[] {
  if (!uuid.test(thread)) throw new Error("Invalid Codex conversation UUID");
  const retained = launchOptions(argv);
  // Even UI-only -c overrides select an embedded server in current Codex.
  // The worker writes appearance settings through the daemon before restarting.
  return ["resume", thread, ...retained];
}
const plainWord = /^[\w@%+=:,./-]+$/;

/**
 * Quote one argument for the interactive shell. Fish and zsh agree on single
 * quotes only when the text has no quote or backslash, so refuse the rest
 * before anything is stopped rather than guess an escape.
 */
function shellWord(value: string): string {
  if (plainWord.test(value)) return value;
  if (/['\\\r\n]/.test(value))
    throw new Error(
      "Launch argument cannot be quoted for the shell; terminal left running",
    );
  return `'${value}'`;
}

/** The line typed into the interactive shell, so its `codex` wrapper policy still applies. */
export function launchCommand(argv: readonly string[], thread: string): string {
  return ["codex", ...resumeArguments(argv, thread)].map((word) => shellWord(word)).join(" ");
}

/**
 * Type the launch line into the terminal's shell. Never retry this write: an
 * uncertain acknowledgement is resolved by verifying the exact process and
 * native conversation UUID.
 */
export async function launchReplacement(
  runtime: Runtime,
  terminal: string,
  command: string,
): Promise<string | undefined> {
  try {
    await runtime.hc(["send", terminal, command]);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Unknown hc launch error";
  }
}
