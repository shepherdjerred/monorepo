import type { Appearance } from "./codex_theme_restart_options.ts";

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
  if (!inline && booleanFlags.has(flag))
    return { retained: [flag], consumed: 1 };
  // Wrappers reapply bypass flags. Passing an already-injected flag back through
  // a wrapper makes Clap reject it as duplicated. Verify the actual new argv below.
  if (!inline && (discardedFlags.has(flag) || bypassFlags.has(flag)))
    return { retained: [], consumed: 1 };
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

/** Keep launch policy, never replay a prompt, fork, image attachment, or worktree creation. */
export function resumeArguments(
  argv: readonly string[],
  thread: string,
  mode: Appearance,
): string[] {
  if (!uuid.test(thread)) throw new Error("Invalid Codex conversation UUID");
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
  const theme = mode === "dark" ? "catppuccin-mocha" : "catppuccin-latte";
  return [
    "resume",
    thread,
    ...retained,
    "-c",
    'tui.resume_cwd="session"',
    "-c",
    `tui.theme="${theme}"`,
  ];
}
