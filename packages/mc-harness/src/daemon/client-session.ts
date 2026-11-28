import type { ClientState, ClientSummary } from "#protocol/client.ts";
import type { LaunchedClient } from "./client-launch.ts";
import { clientRequest } from "./client-socket.ts";
import { DaemonError } from "./http.ts";
import { stopPrism } from "./prism-process.ts";

export type ManagedClientSession = {
  summary: ClientSummary;
  socket: string;
  privateDir: string;
  child?: LaunchedClient;
  bootstrapPath?: string;
  cleanup?: () => Promise<void>;
};

async function ignoreError(action: Promise<unknown>): Promise<void> {
  try {
    await action;
  } catch {
    // Best-effort teardown.
  }
}

async function exitWithin(child: LaunchedClient, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, ms);
  });
  try {
    return await Promise.race([child.exited.then(() => true), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function assertConnectedClientName(
  expectedName: string,
  state: ClientState,
): void {
  const actual = state.connected ? state["name"] : undefined;
  if (typeof actual !== "string" || actual !== expectedName) {
    const label =
      typeof actual === "string" && actual.length > 0 ? actual : "unknown";
    throw new DaemonError(
      `Prism client connected as ${label}, expected ${expectedName}`,
      409,
    );
  }
}

/** Asks the game to quit, then escalates to SIGTERM and SIGKILL. */
export async function stopManagedClientSession(
  session: ManagedClientSession,
  graceMs: number,
  onEnded: (code: number | null) => Promise<void>,
): Promise<void> {
  const { child } = session;
  if (child === undefined) {
    try {
      await clientRequest(session.socket, "shutdown", {}, 5000);
    } catch {
      // Fall back to the verified Prism game process.
    }
    if (session.bootstrapPath === undefined)
      throw new Error("Missing Prism bootstrap path");
    await stopPrism(session.bootstrapPath, graceMs / 3);
    await onEnded(null);
    return;
  }
  if (child.exitCode() === null) {
    try {
      await clientRequest(session.socket, "shutdown", {}, 5000);
    } catch {
      // Not answering is what the signals below are for.
    }
    if (!(await exitWithin(child, graceMs))) {
      await child.kill("SIGTERM");
      if (!(await exitWithin(child, graceMs / 3))) {
        await child.kill("SIGKILL");
        await child.exited;
      }
    }
  }
  if (session.bootstrapPath !== undefined) {
    await ignoreError(
      stopPrism(session.bootstrapPath, Math.min(graceMs / 3, 5000)),
    );
  }
  await onEnded(child.exitCode());
}
