import os from "node:os";
import path from "node:path";
import { installedToolkitPath } from "#lib/credential-cache.ts";
import { parseDelegatedResult, referencesOf } from "#lib/credential-reads.ts";

type Run = (
  argv: string[],
  extraEnvironment?: Readonly<Record<string, string>>,
) => Promise<{ exit: number; stdout: string; stderr: string }>;

/** Set on a Herdr GUI-session child so it never delegates back. */
export const GUI_DELEGATED_ENVIRONMENT = "TOOLKIT_GUI_SESSION_DELEGATED";

export const UNREACHABLE_LOGIN_KEYCHAIN_MARKER =
  "cannot see the login Keychain";

export type GuiBridge = {
  readonly herdrCore: string;
  readonly toolkit: string;
};

export type GuiReader = (
  name: string,
  expectedRef: string | null,
) => Promise<string | null>;

export function isUnreachableLoginKeychainError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes(UNREACHABLE_LOGIN_KEYCHAIN_MARKER)
  );
}

/**
 * The error for a Keychain item that could not be read. A process outside the
 * user's GUI login session, such as a direct SSH session (Tailscale SSH) or a
 * process left behind by an ended SSH login, resolves only the System keychain,
 * so every lookup fails although the item is enrolled; name that instead of
 * sending the operator to re-enroll. Falls back to `enrollmentError` when the
 * login keychain is on the search list or the search list cannot be read.
 */
export async function missingKeychainItemError(
  run: Run,
  enrollmentError: Error,
): Promise<Error> {
  const list = await run(["security", "list-keychains"]);
  if (list.exit !== 0 || list.stdout.includes("login.keychain")) {
    return enrollmentError;
  }
  const searchList = list.stdout
    .split("\n")
    .map((line) => line.trim().replaceAll('"', ""))
    .filter((line) => line.length > 0)
    .join(", ");
  const session = await run(["launchctl", "managername"]);
  const sessionName = session.exit === 0 ? session.stdout.trim() : "unknown";
  return new Error(
    `toolkit: this process ${UNREACHABLE_LOGIN_KEYCHAIN_MARKER} (launchd session: ${sessionName}; search list: ${searchList.length > 0 ? searchList : "empty"}), so enrolled credentials look missing; do not re-enroll. Run the command from a process in the GUI login session (or ensure com.jerred.herdr-core is running there). Direct SSH sessions (such as Tailscale SSH) and processes started by an SSH login stay outside the GUI session.`,
  );
}

function installedHerdrCorePath(): string {
  return path.join(os.homedir(), ".local", "bin", "herdr-core");
}

async function liveGuiBridge(): Promise<GuiBridge | null> {
  if (process.platform !== "darwin") return null;
  if (Bun.env[GUI_DELEGATED_ENVIRONMENT] === "1") return null;
  const herdrCore = installedHerdrCorePath();
  const toolkit = installedToolkitPath();
  const [hasCore, hasToolkit] = await Promise.all([
    Bun.file(herdrCore).exists(),
    Bun.file(toolkit).exists(),
  ]);
  return hasCore && hasToolkit ? { herdrCore, toolkit } : null;
}

export async function resolveGuiBridge(options: {
  readonly herdrCore: string | null | undefined;
  readonly installedToolkit: string | null | undefined;
  readonly liveSubprocesses: boolean;
}): Promise<GuiBridge | null> {
  if (options.herdrCore === null) return null;
  if (options.herdrCore !== undefined) {
    const toolkit = options.installedToolkit;
    return toolkit !== undefined && toolkit !== null
      ? { herdrCore: options.herdrCore, toolkit }
      : null;
  }
  return options.liveSubprocesses ? liveGuiBridge() : null;
}

async function isCoreRunning(bridge: GuiBridge, run: Run): Promise<boolean> {
  const status = await run([bridge.herdrCore, "server", "status", "--json"]);
  return status.exit === 0;
}

export function createGuiReader(bridge: GuiBridge | null, run: Run): GuiReader {
  if (bridge === null) return () => Promise.resolve(null);
  let coreReadyPromise: Promise<boolean> | undefined;
  const coreReady = (): Promise<boolean> => {
    coreReadyPromise ??= isCoreRunning(bridge, run);
    return coreReadyPromise;
  };
  return async (name, expectedRef) => {
    if (Bun.env[GUI_DELEGATED_ENVIRONMENT] === "1") return null;
    if (expectedRef !== null) {
      const references = await referencesOf(bridge.toolkit, run);
      if (references?.get(name) !== expectedRef) return null;
    }
    if (!(await coreReady())) return null;
    const result = await run([
      bridge.herdrCore,
      "exec",
      "--env",
      `${GUI_DELEGATED_ENVIRONMENT}=1`,
      bridge.toolkit,
      "run",
      "--env",
      name,
      "--",
      "/usr/bin/printenv",
      name,
    ]);
    return parseDelegatedResult(name, bridge.toolkit, result);
  };
}

export async function withGuiFallback<T>(
  attempt: () => Promise<T>,
  fallback: () => Promise<T | null>,
): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (!isUnreachableLoginKeychainError(error)) throw error;
    const recovered = await fallback();
    if (recovered !== null) return recovered;
    throw error;
  }
}
