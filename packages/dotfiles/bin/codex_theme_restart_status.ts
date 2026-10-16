import { uuid } from "./codex_theme_restart_launch.ts";
import type {
  Agent,
  ProcessInfo,
  Runtime,
} from "./codex_theme_restart_core.ts";

type Inspection = {
  agent: Agent;
  info: ProcessInfo;
  inspect: () => Promise<{ agent: Agent | undefined; info: ProcessInfo }>;
};

async function readPane(
  runtime: Runtime,
  session: string,
  pane: string,
): Promise<string> {
  const output = await runtime.call(session, [
    "pane",
    "read",
    pane,
    "--source",
    "visible",
    "--format",
    "text",
  ]);
  if (typeof output !== "string" || output.length === 0)
    throw new Error("Missing pane text from Herdr");
  return output;
}

async function waitForScreen(
  runtime: Runtime,
  session: string,
  pane: string,
  ready: (screen: string) => boolean,
): Promise<string> {
  const deadline = runtime.now() + 5000;
  while (runtime.now() < deadline) {
    const screen = await readPane(runtime, session, pane);
    if (ready(screen)) return screen;
    await runtime.sleep(100);
  }
  throw new Error(
    "Native /status did not complete; inspect the pane; no exit attempted",
  );
}

export async function probeNativeConversation(
  runtime: Runtime,
  session: string,
  context: Inspection,
): Promise<Agent> {
  const { agent, info, inspect } = context;
  if (!["idle", "done", "working"].includes(agent.status))
    throw new Error(
      "Pane is blocked or its input state is unknown; left untouched",
    );
  const assertProcess = async () => {
    const { info: current, agent: currentAgent } = await inspect();
    if (
      current.shell !== info.shell ||
      current.foreground !== info.foreground ||
      currentAgent?.terminal !== agent.terminal
    )
      throw new Error(
        "Pane process or terminal changed during identity probe; left untouched",
      );
    if (!["idle", "done", "working"].includes(currentAgent.status))
      throw new Error("Pane input became blocked; left untouched");
  };
  requireEmptyComposer(await readPane(runtime, session, agent.pane));
  await assertProcess();
  // Observe the local command in the composer before Enter, then observe its
  // completion. Identical status cards can replace each other on a full screen;
  // comparing history snapshots cannot establish whether the command ran.
  await runtime.call(session, ["pane", "send-text", agent.pane, "/status"]);
  await waitForScreen(runtime, session, agent.pane, statusCommandStaged);
  await assertProcess();
  await runtime.call(session, ["agent", "send-keys", agent.pane, "enter"]);
  const screen = await waitForScreen(
    runtime,
    session,
    agent.pane,
    (value) => emptyComposer(value) && nativeConversation(value) !== undefined,
  );
  const thread = nativeConversation(screen);
  if (thread === undefined)
    throw new Error(
      "Native /status did not report a conversation UUID; pane left running",
    );
  await assertProcess();
  requireEmptyComposer(await readPane(runtime, session, agent.pane));
  await runtime.call(session, [
    "pane",
    "report-agent-session",
    agent.pane,
    "--source",
    "herdr:codex",
    "--agent",
    "codex",
    "--agent-session-id",
    thread,
    "--session-start-source",
    "resume",
  ]);
  const { agent: reported } = await inspect();
  if (reported?.terminal !== agent.terminal || reported.thread !== thread)
    throw new Error(
      "Herdr did not retain the verified native conversation identity",
    );
  return reported;
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
  session: string,
  pane: string,
  { screen, selected }: { screen: string; selected: RegExp },
): Promise<void> {
  if (!selected.test(screen)) {
    await runtime.call(session, ["agent", "send-keys", pane, "down"]);
    await waitForScreen(runtime, session, pane, (value) =>
      selected.test(value),
    );
  }
  await runtime.call(session, ["agent", "send-keys", pane, "enter"]);
}

/** A resumed paused goal must stay paused; never accept the default resume action. */
export async function preservePausedGoal(
  runtime: Runtime,
  session: string,
  pane: string,
): Promise<void> {
  const screen = await readPane(runtime, session, pane);
  if (!screen.includes("Resume paused goal?")) return;
  const selected = /›\s*2\. Leave paused/;
  if (
    !screen.includes("Keep it paused; use /goal resume later") ||
    !screen.includes("enter select · esc back") ||
    (!/›\s*1\. Resume goal/.test(screen) && !selected.test(screen))
  )
    throw new Error("Unrecognized paused-goal dialog; left untouched");
  await selectSecondChoice(runtime, session, pane, { screen, selected });
  await waitForScreen(
    runtime,
    session,
    pane,
    (value) => !value.includes("Resume paused goal?") && emptyComposer(value),
  );
}

/** Exit only the client when its shared-daemon task is still running. */
export async function backgroundRunningTask(
  runtime: Runtime,
  session: string,
  pane: string,
): Promise<void> {
  const screen = await readPane(runtime, session, pane);
  if (!screen.includes("Task is still running")) return;
  const selected = /›\s*2\. Run in background/;
  if (
    !screen.includes("Exit Codex and leave the task running") ||
    !screen.includes("enter select · esc back") ||
    (!/›\s*1\. Cancel task/.test(screen) && !selected.test(screen))
  )
    throw new Error("Unrecognized running-task exit dialog; left untouched");
  await selectSecondChoice(runtime, session, pane, { screen, selected });
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
