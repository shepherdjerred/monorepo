import { createHash } from "node:crypto";
import type { Runtime, Target } from "./codex_theme_restart_core.ts";

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
  throw new Error("Unsupported Codex launch option; pane left running");
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
/** Herdr may lose its temporary name while acknowledging a successful launch.
 * Never retry this write: the caller must verify the exact pane and native UUID.
 */
export async function launchReplacement(
  runtime: Runtime,
  target: Target,
): Promise<string | undefined> {
  const { session, agent } = target;
  const name =
    agent.name ??
    `theme-${createHash("sha256").update(`${session}/${agent.terminal}`).digest("hex").slice(0, 12)}`;
  try {
    // Launch through the existing interactive shell to retain its wrapper policy.
    await runtime.call(session, [
      "agent",
      "start",
      name,
      "--kind",
      "codex",
      "--pane",
      agent.pane,
      "--timeout",
      "30000",
      "--",
      ...target.args,
    ]);
    return undefined;
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "Unknown Herdr launch error";
  }
}
