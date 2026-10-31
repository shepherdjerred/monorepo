import {
  bypassFlags,
  launchCommand,
  launchReplacement,
} from "./codex_theme_restart_launch.ts";
import type { Appearance } from "./codex_theme_restart_options.ts";
import {
  backgroundRunningTask,
  preservePausedGoal,
  probeNativeConversation,
  waitForStartup,
} from "./codex_theme_restart_status.ts";
import {
  parseCodexTerminals,
  parseJson,
  snapshotOf,
  type Runtime,
  type Snapshot,
} from "./codex_theme_restart_terminal.ts";

export type Target = {
  terminal: string;
  status: string;
  /** Verified by native `/status`; absent in a read-only preview. */
  thread: string | undefined;
  /** The terminal's own shell, which must survive the restart. */
  shell: number;
  /** The Codex foreground process being replaced. */
  pid: number;
  argv: string[];
  bypass: string[];
  mode: Appearance;
};
export type Outcome = {
  terminal: string;
  status: "restarted" | "skipped" | "failed" | "would-restart" | "identified";
  message: string;
};

/** Stands in for the conversation UUID to check launch options and shell quoting before any key is typed. */
const previewThread = "00000000-0000-0000-0000-000000000000";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown restart error";
}

function executable(snapshot: Snapshot): string | undefined {
  return snapshot.foreground.argv[0]?.split("/").at(-1);
}

async function probeConversation(
  runtime: Runtime,
  snapshot: Snapshot,
  options: { allowUnreported?: boolean } = {},
): Promise<string> {
  const thread = await probeNativeConversation(runtime, snapshot, options);
  if (!runtime.conversationSaved(thread))
    throw new Error("Conversation has no saved history; client left running");
  return thread;
}

export async function discover(
  runtime: Runtime,
  mode: Appearance,
  selection: { terminal?: string; probe?: boolean } = {},
): Promise<{ targets: Target[]; outcomes: Outcome[] }> {
  const { terminal: selected, probe = false } = selection;
  const addresses = parseCodexTerminals(
    parseJson(await runtime.hc(["ls", "--json"])),
  );
  const targets: Target[] = [];
  const outcomes: Outcome[] = [];
  for (const terminal of addresses) {
    if (selected !== undefined && terminal !== selected) continue;
    try {
      const snapshot = await snapshotOf(runtime, terminal);
      // Validate launch options before touching the native composer.
      launchCommand(snapshot.foreground.argv, previewThread);
      const thread = probe
        ? await probeConversation(runtime, snapshot)
        : undefined;
      targets.push({
        terminal,
        status: snapshot.status,
        thread,
        shell: snapshot.shell,
        pid: snapshot.foreground.pid,
        argv: snapshot.foreground.argv,
        bypass: snapshot.foreground.argv.filter((argument) =>
          bypassFlags.has(argument),
        ),
        mode,
      });
    } catch (error) {
      outcomes.push({
        terminal,
        status: "skipped",
        message: errorMessage(error),
      });
    }
  }
  if (selected !== undefined && targets.length === 0 && outcomes.length === 0) {
    outcomes.push({
      terminal: selected,
      status: "skipped",
      message: "No live local Codex terminal at requested address",
    });
  }
  return { targets, outcomes };
}

const continuation =
  "Continue the task interrupted by the appearance-change restart. First inspect current state and any in-flight command results. Do not repeat completed work or external actions whose outcome is uncertain.";

async function shellReady(runtime: Runtime, target: Target): Promise<boolean> {
  const snapshot = await snapshotOf(runtime, target.terminal);
  if (snapshot.shell !== target.shell)
    throw new Error("Terminal shell changed during restart");
  if (snapshot.foreground.pid === snapshot.shell) return true;
  if (snapshot.foreground.pid !== target.pid)
    throw new Error("Foreground process changed; no further keys sent");
  return false;
}

async function exitCodex(runtime: Runtime, target: Target): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await shellReady(runtime, target)) return;
    await runtime.hc(["keys", target.terminal, "ctrl+c"]);
    await runtime.sleep(350);
    await backgroundRunningTask(runtime, target.terminal);
  }
  const deadline = runtime.now() + 5000;
  while (runtime.now() < deadline) {
    if (await shellReady(runtime, target)) return;
    await runtime.sleep(100);
  }
  throw new Error(
    "Codex did not exit within 5 seconds; no force-kill attempted",
  );
}

/** `hc send` returns before the shell runs the line, so wait for the new client. */
async function awaitReplacement(
  runtime: Runtime,
  target: Target,
  thread: string,
): Promise<Snapshot> {
  const deadline = runtime.now() + 30_000;
  const mismatch = "Restarted process does not match the requested conversation";
  for (;;) {
    const snapshot = await snapshotOf(runtime, target.terminal);
    if (snapshot.shell !== target.shell)
      throw new Error("Terminal shell changed during restart");
    const { pid, argv } = snapshot.foreground;
    if (pid !== snapshot.shell && pid !== target.pid && executable(snapshot) === "codex") {
        if (
          !argv.some(
            (argument, index) =>
              argument === "resume" && argv[index + 1] === thread,
          )
        )
          throw new Error(mismatch);
        return snapshot;
      }
    if (runtime.now() >= deadline) throw new Error(mismatch);
    await runtime.sleep(200);
  }
}

async function verifyLaunch(
  runtime: Runtime,
  target: Target,
  thread: string,
): Promise<Snapshot> {
  if (!(await runtime.appearanceConfigured(target.mode)))
    throw new Error("Codex appearance settings changed during restart");
  const replacement = await awaitReplacement(runtime, target, thread);
  if (!target.bypass.every((flag) => replacement.foreground.argv.includes(flag))) {
    throw new Error(
      "Wrapper did not preserve observed bypass flags; no continuation sent",
    );
  }
  await waitForStartup(runtime, target.terminal);
  await preservePausedGoal(runtime, target.terminal);
  // A client that has just started may not have reported a status yet.
  const resumed = await probeConversation(
    runtime,
    await snapshotOf(runtime, target.terminal),
    { allowUnreported: true },
  );
  if (resumed !== thread)
    throw new Error("Native /status reported a different resumed conversation");
  return snapshotOf(runtime, target.terminal);
}

async function settledStatus(
  runtime: Runtime,
  terminal: string,
): Promise<Snapshot> {
  const deadline = runtime.now() + 10_000;
  for (;;) {
    const snapshot = await snapshotOf(runtime, terminal);
    if (snapshot.status !== "unknown") return snapshot;
    if (runtime.now() >= deadline) return snapshot;
    await runtime.sleep(200);
  }
}

async function continueTerminal(
  runtime: Runtime,
  target: Target,
  { thread, wasWorking }: { thread: string; wasWorking: boolean },
  continued: Set<string>,
): Promise<string> {
  await verifyLaunch(runtime, target, thread);
  if (!wasWorking) return "Same conversation restored";
  if (continued.has(thread))
    return "Same conversation restored; continuation already handled";
  const resumed = await settledStatus(runtime, target.terminal);
  if (resumed.status === "working") {
    continued.add(thread);
    return "Existing turn is already working; no duplicate prompt sent";
  }
  if (resumed.status !== "idle" && resumed.status !== "done") {
    throw new Error(
      "Conversation restored but not ready for continuation; inspect terminal",
    );
  }
  continued.add(thread);
  await runtime.hc(["send", target.terminal, continuation]);
  return "Same conversation restored; continuation submitted once";
}

export async function restart(
  runtime: Runtime,
  target: Target,
  continued = new Set<string>(),
): Promise<Outcome> {
  const { terminal } = target;
  const outcome = (status: Outcome["status"], message: string): Outcome => ({
    terminal,
    status,
    message,
  });
  try {
    if (target.thread === undefined)
      throw new Error("Restart requires a verified conversation");
    const before = await snapshotOf(runtime, terminal);
    if (
      before.shell !== target.shell ||
      before.foreground.pid !== target.pid
    )
      return outcome("skipped", "Terminal process changed before restart");
    const thread = await probeConversation(runtime, before);
    if (thread !== target.thread)
      return outcome("skipped", "Terminal conversation changed before restart");
    // Use the last observed working state, not a potentially old discovery snapshot.
    const observed = await snapshotOf(runtime, terminal);
    const wasWorking = observed.status === "working";
    // Quote the launch line before stopping anything.
    const command = launchCommand(target.argv, thread);
    await exitCodex(runtime, target);
    const startError = await launchReplacement(runtime, terminal, command);
    const message = await continueTerminal(
      runtime,
      target,
      { thread, wasWorking },
      continued,
    ).catch((error: unknown) => {
      if (startError !== undefined)
        throw new Error(`${startError}; ${errorMessage(error)}`);
      throw error;
    });
    return outcome(
      "restarted",
      startError === undefined
        ? message
        : `${message}; hc launch acknowledgement failed but terminal verified (${startError})`,
    );
  } catch (error) {
    return outcome("failed", errorMessage(error));
  }
}
