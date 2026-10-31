import { uuid } from "./codex_theme_restart_launch.ts";
import {
  snapshotOf,
  type Runtime,
  type Snapshot,
} from "./codex_theme_restart_terminal.ts";

const inputStates = new Set(["idle", "done", "working"]);
const statusKeys = ["/", "s", "t", "a", "t", "u", "s"];

async function readTerminal(
  runtime: Runtime,
  terminal: string,
): Promise<string> {
  const output = await runtime.hc(["read", terminal]);
  if (output.length === 0) throw new Error("Missing terminal text from hc");
  return output;
}

async function waitForScreen(
  runtime: Runtime,
  terminal: string,
  ready: (screen: string) => boolean,
  failure = "Native /status did not complete; inspect the terminal; no exit attempted",
): Promise<string> {
  const deadline = runtime.now() + 5000;
  while (runtime.now() < deadline) {
    const screen = await readTerminal(runtime, terminal);
    if (ready(screen)) return screen;
    await runtime.sleep(100);
  }
  throw new Error(failure);
}

/**
 * Ask the running Codex for its current conversation with the native `/status`
 * command. Neither hc nor Codex hooks report the conversation, and launch
 * arguments go stale after `/new` or `/resume`. A client that has just started
 * may not have reported a status yet, which `allowUnreported` accepts.
 */
export async function probeNativeConversation(
  runtime: Runtime,
  snapshot: Snapshot,
  { allowUnreported = false }: { allowUnreported?: boolean } = {},
): Promise<string> {
  const { terminal } = snapshot;
  const acceptable = (status: string) =>
    inputStates.has(status) || (allowUnreported && status === "unknown");
  if (!acceptable(snapshot.status))
    throw new Error(
      "Terminal is blocked or its input state is unknown; left untouched",
    );
  const assertProcess = async () => {
    const current = await snapshotOf(runtime, terminal);
    if (
      current.shell !== snapshot.shell ||
      current.foreground.pid !== snapshot.foreground.pid
    )
      throw new Error(
        "Terminal process changed during identity probe; left untouched",
      );
    if (!acceptable(current.status))
      throw new Error("Terminal input became blocked; left untouched");
  };
  requireEmptyComposer(await readTerminal(runtime, terminal));
  await assertProcess();
  // Observe the local command in the composer before Enter, then observe its
  // completion. Identical status cards can replace each other on a full screen;
  // comparing history snapshots cannot establish whether the command ran.
  await runtime.hc(["keys", terminal, ...statusKeys]);
  await waitForScreen(runtime, terminal, statusCommandStaged);
  await assertProcess();
  await runtime.hc(["keys", terminal, "enter"]);
  const screen = await waitForScreen(
    runtime,
    terminal,
    (value) => emptyComposer(value) && nativeConversation(value) !== undefined,
  );
  const thread = nativeConversation(screen);
  if (thread === undefined)
    throw new Error(
      "Native /status did not report a conversation UUID; terminal left running",
    );
  await assertProcess();
  requireEmptyComposer(await readTerminal(runtime, terminal));
  return thread;
}

/** A freshly started client is ready once it shows its composer or the paused-goal dialog. */
export async function waitForStartup(
  runtime: Runtime,
  terminal: string,
): Promise<void> {
  await waitForScreen(
    runtime,
    terminal,
    (screen) => screen.includes("Resume paused goal?") || emptyComposer(screen),
    "Restarted Codex did not show its composer within 5 seconds",
  );
}

/** Only the live composer counts; quoted prompts elsewhere in the transcript do not. */
function emptyComposer(screen: string): boolean {
  const lines = screen.split("\n");
  const composer = lines.findLastIndex((line) => /^\s*›/.test(line));
  return (
    composer !== -1 &&
    !screen.includes("enter select · esc back") &&
    !screen.includes("Resume paused goal?") &&
    lines[composer]?.trim() === "› Ask Codex to do anything" &&
    !lines
      .slice(composer + 1)
      .some((line) => /^\s*\S/.test(line) && !/^\s{2,}/.test(line)) &&
    !/Vim: (?:Normal|Replace)/.test(lines.slice(composer).join("\n"))
  );
}

async function selectSecondChoice(
  runtime: Runtime,
  terminal: string,
  { screen, selected }: { screen: string; selected: RegExp },
): Promise<void> {
  if (!selected.test(screen)) {
    await runtime.hc(["keys", terminal, "down"]);
    await waitForScreen(runtime, terminal, (value) => selected.test(value));
  }
  await runtime.hc(["keys", terminal, "enter"]);
}

/** A resumed paused goal must stay paused; never accept the default resume action. */
export async function preservePausedGoal(
  runtime: Runtime,
  terminal: string,
): Promise<void> {
  const screen = await readTerminal(runtime, terminal);
  if (!screen.includes("Resume paused goal?")) return;
  const selected = /›\s*2\. Leave paused/;
  if (
    !screen.includes("Keep it paused; use /goal resume later") ||
    !screen.includes("enter select · esc back") ||
    (!/›\s*1\. Resume goal/.test(screen) && !selected.test(screen))
  )
    throw new Error("Unrecognized paused-goal dialog; left untouched");
  await selectSecondChoice(runtime, terminal, { screen, selected });
  await waitForScreen(
    runtime,
    terminal,
    (value) => !value.includes("Resume paused goal?") && emptyComposer(value),
  );
}

/** Exit only the client when its shared-daemon task is still running. */
export async function backgroundRunningTask(
  runtime: Runtime,
  terminal: string,
): Promise<void> {
  const screen = await readTerminal(runtime, terminal);
  if (!screen.includes("Task is still running")) return;
  const selected = /›\s*2\. Run in background/;
  if (
    !screen.includes("Exit Codex and leave the task running") ||
    !screen.includes("enter select · esc back") ||
    (!/›\s*1\. Cancel task/.test(screen) && !selected.test(screen))
  )
    throw new Error("Unrecognized running-task exit dialog; left untouched");
  await selectSecondChoice(runtime, terminal, { screen, selected });
}

export function requireEmptyComposer(screen: string): void {
  if (!emptyComposer(screen)) {
    throw new Error(
      "Composer is not confirmed empty and ready; draft or dialog left untouched",
    );
  }
}

export function statusCommandStaged(screen: string): boolean {
  return (
    screen
      .split("\n")
      .findLast((line) => /^\s*›/.test(line))
      ?.trim() === "› /status"
  );
}

/** Called only after observing the staged native command and its completed submission. */
export function nativeConversation(screen: string): string | undefined {
  const commands = [...screen.matchAll(/^\s*(?:›\s*)?\/status\s*$/gm)];
  const command = commands.at(-1);
  if (command === undefined) return undefined;
  const card = screen.slice(command.index + command[0].length);
  if (!/^\s*>_ OpenAI Codex \(v[^\n]+\)/m.test(card)) return undefined;
  const sessions = [...card.matchAll(/^\s*Session:\s+(\S+)\s*$/gm)];
  const thread = sessions[0]?.[1];
  return thread !== undefined && sessions.length === 1 && uuid.test(thread)
    ? thread
    : undefined;
}
