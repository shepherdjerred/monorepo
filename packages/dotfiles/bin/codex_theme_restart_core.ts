import {
  launchedTheme,
  themeForAppearance,
} from "./codex_theme_restart_config.ts";
import {
  bypassFlags,
  launchCommand,
  launchReplacement,
} from "./codex_theme_restart_launch.ts";
import type { Appearance } from "./codex_theme_restart_options.ts";
import {
  emptyComposer,
  preservePausedGoal,
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
  snapshot: Snapshot;
  thread: string;
  mode: Appearance;
};
export type Outcome = {
  terminal: string;
  status: "restarted" | "skipped" | "failed" | "would-restart" | "identified";
  message: string;
  retry?: boolean;
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown restart error";
}

function executable(snapshot: Snapshot): string | undefined {
  return snapshot.foreground.argv[0]?.split("/").at(-1);
}

function sameTerminal(next: Snapshot, original: Snapshot): boolean {
  return next.shell === original.shell && next.created === original.created;
}

export async function verifiedSnapshot(
  runtime: Runtime,
  target: Target,
): Promise<Snapshot> {
  const { snapshot, thread } = target;
  const current = await snapshotOf(runtime, snapshot.terminal);
  if (
    !sameTerminal(current, snapshot) ||
    current.foreground.pid !== snapshot.foreground.pid
  )
    throw new Error("Terminal process changed before restart");
  if ((await runtime.identity(current)) !== thread)
    throw new Error("Terminal conversation changed before restart");
  return current;
}

async function verifiedTarget(
  runtime: Runtime,
  snapshot: Snapshot,
  mode: Appearance,
): Promise<Target> {
  if (executable(snapshot) !== "codex")
    throw new Error("Foreground process is not Codex");
  const root = snapshot.shellProgram.split("/").at(-1)?.replace(/^-/, "");
  if (
    snapshot.shell === snapshot.foreground.pid ||
    (root !== "fish" && root !== "zsh" && root !== "bash")
  )
    throw new Error("Codex must be running inside a supported Herdr shell");
  const thread = await runtime.identity(snapshot);
  if (thread === undefined)
    throw new Error(
      "No verified saved conversation. Trust the Herdr hooks in /hooks and use the managed Codex wrapper.",
    );
  if (snapshot.foreground.cwd === undefined)
    throw new Error("Codex working directory is unavailable");
  // Reject an unsupported launch or unsafe shell argument before stopping Codex.
  launchCommand(snapshot.foreground.argv, thread, snapshot.foreground.cwd);
  return { snapshot, thread, mode };
}

export async function discover(
  runtime: Runtime,
  mode: Appearance,
  selection: { terminal?: string; onChange?: boolean } = {},
): Promise<{ targets: Target[]; outcomes: Outcome[] }> {
  const { terminal: selected, onChange } = selection;
  const addresses = parseCodexTerminals(
    parseJson(await runtime.hc(["ls", "--json"])),
  );
  const targets: Target[] = [];
  const outcomes: Outcome[] = [];
  for (const terminal of addresses) {
    if (selected !== undefined && terminal !== selected) continue;
    try {
      const snapshot = await snapshotOf(runtime, terminal);
      if (
        onChange === true &&
        launchedTheme(snapshot.foreground.argv) === themeForAppearance(mode)
      )
        continue;
      targets.push(await verifiedTarget(runtime, snapshot, mode));
    } catch (error) {
      outcomes.push({
        terminal,
        status: "skipped",
        message: errorMessage(error),
      });
    }
  }
  if (selected !== undefined && !addresses.includes(selected))
    outcomes.push({
      terminal: selected,
      status: "skipped",
      message: "No live local Codex terminal at requested address",
    });
  return { targets, outcomes };
}

export async function readiness(
  runtime: Runtime,
  target: Target,
): Promise<Snapshot | undefined> {
  // Herdr clears agent status before it necessarily refreshes the foreground
  // PID. Check status first, since an exited client's footer is already gone.
  const current = await snapshotOf(runtime, target.snapshot.terminal);
  if (current.status !== "done" && current.status !== "idle") return undefined;
  const verified = await verifiedSnapshot(runtime, target);
  if (verified.status !== "done" && verified.status !== "idle") return undefined;
  return (await composerReady(runtime, verified)) ? verified : undefined;
}

async function composerReady(
  runtime: Runtime,
  current: Snapshot,
): Promise<boolean> {
  return emptyComposer(await runtime.hc(["read", current.terminal]));
}

async function originalStillRunning(
  runtime: Runtime,
  snapshot: Snapshot,
): Promise<boolean> {
  const current = await snapshotOf(runtime, snapshot.terminal);
  if (!sameTerminal(current, snapshot))
    throw new Error("Terminal shell changed during restart");
  if (current.foreground.pid === current.shell) return false;
  if (current.foreground.pid !== snapshot.foreground.pid)
    throw new Error("Foreground process changed during restart");
  return true;
}

async function exitCodex(runtime: Runtime, target: Target): Promise<void> {
  const { snapshot } = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await originalStillRunning(runtime, snapshot))) return;
    // hc can clear agent status on exit before it updates the foreground PID.
    // If the composer disappeared, wait for the shell and send no further keys.
    if ((await readiness(runtime, target)) === undefined) break;
    await runtime.hc(["keys", snapshot.terminal, "ctrl+c"]);
    await runtime.sleep(350);
  }
  const deadline = runtime.now() + 5000;
  while (runtime.now() < deadline) {
    if (!(await originalStillRunning(runtime, snapshot))) return;
    await runtime.sleep(100);
  }
  throw new Error("Codex did not exit within 5 seconds");
}

async function awaitReplacement(
  runtime: Runtime,
  target: Target,
): Promise<Snapshot> {
  const { snapshot, thread } = target;
  const deadline = runtime.now() + 30_000;
  while (runtime.now() < deadline) {
    const current = await snapshotOf(runtime, snapshot.terminal);
    if (!sameTerminal(current, snapshot))
      throw new Error("Terminal shell changed during restart");
    const { pid, argv } = current.foreground;
    if (pid !== snapshot.foreground.pid && executable(current) === "codex") {
      const resumed = argv.some(
        (argument, index) =>
          argument === "resume" && argv[index + 1] === thread,
      );
      if (!resumed)
        throw new Error(
          "Restarted process does not match the requested conversation",
        );
      if (await replacementIdentity(runtime, current, target)) return current;
    }
    await runtime.sleep(200);
  }
  throw new Error(
    "Restarted Codex did not confirm the conversation through its hook",
  );
}

async function replacementIdentity(
  runtime: Runtime,
  current: Snapshot,
  { snapshot, thread }: Target,
): Promise<boolean> {
  const identity = await runtime.identity(current);
  if (identity === undefined)
    return (await runtime.adoptIdentity?.(current, snapshot, thread)) === true;
  if (identity !== thread)
    throw new Error("Restarted Codex reported a different conversation");
  return true;
}

export async function restart(
  runtime: Runtime,
  target: Target,
  policy: { interruptWorking?: boolean; expectedTurn?: number } = {},
): Promise<Outcome> {
  const { snapshot, mode, thread } = target;
  const { terminal } = snapshot;
  try {
    let current = await verifiedSnapshot(runtime, target);
    if (current.status === "working" && policy.interruptWorking === true) {
      if (current.turn !== (policy.expectedTurn ?? snapshot.turn))
        return {
          terminal,
          status: "skipped",
          message: "Codex started another turn before confirmation",
        };
      if (!(await composerReady(runtime, current)))
        return {
          terminal,
          status: "skipped",
          message: "Draft or dialog is present",
        };
      current = await verifiedSnapshot(runtime, target);
      if (current.status === "working") {
        if (current.turn !== (policy.expectedTurn ?? snapshot.turn))
          return {
            terminal,
            status: "skipped",
            message: "The confirmed turn already changed",
          };
        await runtime.hc(["interrupt", terminal, "--timeout", "5"]);
      }
    }
    if ((await readiness(runtime, target)) === undefined)
      return {
        terminal,
        status: "skipped",
        message: "Waiting for idle Codex with an empty composer",
        retry: true,
      };
    const command = launchCommand(
      current.foreground.argv,
      thread,
      current.foreground.cwd,
    );
    await exitCodex(runtime, target);
    const startError = await launchReplacement(runtime, terminal, command);
    const replacement = await awaitReplacement(runtime, target).catch(
      (error: unknown) => {
        if (startError !== undefined)
          throw new Error(`${startError}. ${errorMessage(error)}`);
        throw error;
      },
    );
    const argv = replacement.foreground.argv;
    if (
      !current.foreground.argv
        .filter((arg) => bypassFlags.has(arg))
        .every((flag) => argv.includes(flag))
    )
      throw new Error(
        "Replacement did not preserve the observed launch policy",
      );
    await waitForStartup(runtime, terminal);
    await preservePausedGoal(runtime, terminal, async () => {
      await verifiedSnapshot(runtime, { ...target, snapshot: replacement });
    });
    if (launchedTheme(argv) !== themeForAppearance(mode))
      throw new Error(
        "Conversation restored but the wrapper applied the wrong theme",
      );
    return {
      terminal,
      status: "restarted",
      message: "Same conversation restored",
    };
  } catch (error) {
    return { terminal, status: "failed", message: errorMessage(error) };
  }
}

export async function waitForReadiness(
  runtime: Runtime,
  target: Target,
  cancelled: (current: Snapshot) => Promise<boolean>,
): Promise<boolean> {
  const deadline = runtime.now() + 60 * 60_000;
  const { terminal } = target.snapshot;
  while (runtime.now() < deadline) {
    let current;
    try {
      current = await verifiedSnapshot(runtime, target);
    } catch {
      return false; // The terminal closed or changed before it was eligible.
    }
    if (await cancelled(current)) return false;
    if ((await readiness(runtime, target)) !== undefined) return true;
    if (current.status === "working") {
      // The timeout is a check-in, including when no news has arrived.
      await runtime.hc(["wait", terminal, "--timeout", "15"]).catch(() => "");
    }
    // A draft or dialog can disappear without changing hc's agent status.
    await runtime.sleep(2500);
  }
  return false;
}
