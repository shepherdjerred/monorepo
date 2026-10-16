import {
  bypassFlags,
  launchReplacement,
  resumeArguments,
  validateLaunchArguments,
  uuid,
} from "./codex_theme_restart_launch.ts";
import type { Appearance } from "./codex_theme_restart_options.ts";
import {
  backgroundRunningTask,
  preservePausedGoal,
  probeNativeConversation,
} from "./codex_theme_restart_status.ts";

export function object(value: unknown): Map<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Expected a JSON object");
  return new Map<string, unknown>(Object.entries(value));
}

function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new TypeError("Expected a nonempty string");
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new TypeError("Expected a JSON array");
  return value;
}

function pid(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Expected a positive process ID");
  }
  return value;
}

const states = new Set(["idle", "done", "working", "blocked", "unknown"]);

export type Agent = {
  pane: string;
  terminal: string;
  status: string;
  thread: string | undefined;
  sessionSource: string | undefined;
  name: string | undefined;
};

export function parseAgent(value: unknown): Agent | undefined {
  const agent = object(value);
  if (agent.get("agent") !== "codex") return undefined;
  const status = string(agent.get("agent_status"));
  if (!states.has(status)) throw new Error("Unrecognized Herdr agent state");
  let thread: string | undefined;
  let sessionSource: string | undefined;
  if (
    agent.get("agent_session") !== undefined &&
    agent.get("agent_session") !== null
  ) {
    const session = object(agent.get("agent_session"));
    if (session.get("agent") === "codex" && session.get("kind") === "id") {
      thread = string(session.get("value"));
      sessionSource = string(session.get("source"));
      if (!uuid.test(thread))
        throw new Error("Invalid Codex conversation UUID");
    }
  }
  return {
    pane: string(agent.get("pane_id")),
    terminal: string(agent.get("terminal_id")),
    status,
    thread,
    sessionSource,
    name: agent.get("name") == null ? undefined : string(agent.get("name")),
  };
}

export type ProcessInfo = {
  shell: number;
  foreground: number | undefined;
  processes: { pid: number; argv: string[]; cwd: string }[];
};

export function parseProcessInfo(value: unknown): ProcessInfo {
  const info = object(value);
  return {
    shell: pid(info.get("shell_pid")),
    foreground:
      info.get("foreground_process_group_id") == null
        ? undefined
        : pid(info.get("foreground_process_group_id")),
    processes: array(info.get("foreground_processes")).map((entry) => {
      const process = object(entry);
      return {
        pid: pid(process.get("pid")),
        argv: array(process.get("argv")).map((argument) => string(argument)),
        cwd: string(process.get("cwd")),
      };
    }),
  };
}

export type Target = {
  session: string;
  agent: Agent;
  pid: number;
  shell: number;
  args: string[];
  bypass: string[];
  nativeStatus: boolean;
  mode: Appearance;
};
export type Outcome = {
  session: string;
  pane: string;
  status: "restarted" | "skipped" | "failed" | "would-restart" | "identified";
  message: string;
};
export type Runtime = {
  call: (session: string, args: readonly string[]) => Promise<unknown>;
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  conversationSaved: (thread: string) => boolean;
  appearanceConfigured: (mode: Appearance) => boolean | Promise<boolean>;
};

async function agentAt(
  runtime: Runtime,
  session: string,
  pane: string,
): Promise<Agent | undefined> {
  return parseAgent(
    object(await runtime.call(session, ["pane", "get", pane])).get("pane"),
  );
}
async function processesAt(
  runtime: Runtime,
  session: string,
  pane: string,
): Promise<ProcessInfo> {
  return parseProcessInfo(
    object(
      await runtime.call(session, ["pane", "process-info", "--pane", pane]),
    ).get("process_info"),
  );
}

async function probeConversation(
  runtime: Runtime,
  session: string,
  agent: Agent,
  info: ProcessInfo,
): Promise<Agent> {
  const verified = await probeNativeConversation(runtime, session, {
    agent,
    info,
    inspect: async () => ({
      agent: await agentAt(runtime, session, agent.pane),
      info: await processesAt(runtime, session, agent.pane),
    }),
  });
  if (!runtime.conversationSaved(string(verified.thread)))
    throw new Error("Conversation has no saved history; client left running");
  return verified;
}

export async function discover(
  runtime: Runtime,
  session: string,
  mode: Appearance,
  selection: { pane?: string; probe?: boolean } = {},
): Promise<{ targets: Target[]; outcomes: Outcome[] }> {
  const { pane, probe = false } = selection;
  const result = object(await runtime.call(session, ["agent", "list"]));
  const targets: Target[] = [];
  const outcomes: Outcome[] = [];
  for (const entry of array(result.get("agents"))) {
    let agent = parseAgent(entry);
    if (agent === undefined || (pane !== undefined && agent.pane !== pane))
      continue;
    try {
      if (!probe && agent.thread === undefined)
        throw new Error("No authoritative conversation ID; pane left running");
      const info = await processesAt(runtime, session, agent.pane);
      const process = info.processes.find(
        (candidate) => candidate.pid === info.foreground,
      );
      if (!process)
        throw new Error(
          "No unique foreground Codex process; pane left running",
        );
      // Validate launch options before touching the native composer.
      validateLaunchArguments(process.argv);
      if (probe) agent = await probeConversation(runtime, session, agent, info);
      targets.push({
        session,
        agent,
        pid: process.pid,
        shell: info.shell,
        args: resumeArguments(process.argv, string(agent.thread)),
        bypass: process.argv.filter((argument) => bypassFlags.has(argument)),
        nativeStatus: probe,
        mode,
      });
    } catch (error) {
      outcomes.push({
        session,
        pane: agent.pane,
        status: "skipped",
        message: errorMessage(error),
      });
    }
  }
  if (pane !== undefined && targets.length === 0 && outcomes.length === 0) {
    outcomes.push({
      session,
      pane,
      status: "skipped",
      message: "No Codex agent in requested pane",
    });
  }
  return { targets, outcomes };
}

function matches(agent: Agent | undefined, target: Target): boolean {
  return (
    agent?.terminal === target.agent.terminal &&
    agent.thread === target.agent.thread
  );
}

const continuation =
  "Continue the task interrupted by the appearance-change restart. First inspect current state and any in-flight command results. Do not repeat completed work or external actions whose outcome is uncertain.";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown restart error";
}

async function shellReady(runtime: Runtime, target: Target): Promise<boolean> {
  const info = await processesAt(runtime, target.session, target.agent.pane);
  if (info.shell !== target.shell)
    throw new Error("Pane shell changed during restart");
  if (info.foreground === info.shell) return true;
  if (
    info.foreground !== target.pid ||
    !info.processes.some((process) => process.pid === target.pid)
  ) {
    throw new Error("Foreground process changed; no further keys sent");
  }
  return false;
}

async function exitCodex(runtime: Runtime, target: Target): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await shellReady(runtime, target)) return;
    if (
      !matches(
        await agentAt(runtime, target.session, target.agent.pane),
        target,
      )
    ) {
      throw new Error("Pane conversation changed; no further keys sent");
    }
    await runtime.call(target.session, [
      "agent",
      "send-keys",
      target.agent.pane,
      "ctrl+c",
    ]);
    await runtime.sleep(350);
    await backgroundRunningTask(runtime, target.session, target.agent.pane);
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

async function verifyLaunch(runtime: Runtime, target: Target): Promise<Agent> {
  if (!(await runtime.appearanceConfigured(target.mode)))
    throw new Error("Codex appearance settings changed during restart");
  const info = await processesAt(runtime, target.session, target.agent.pane);
  const process = info.processes.find(
    (candidate) => candidate.pid === info.foreground,
  );
  if (
    process === undefined ||
    info.shell !== target.shell ||
    process.pid === target.pid ||
    process.argv[0]?.split("/").at(-1) !== "codex" ||
    !process.argv.some(
      (argument, index) =>
        argument === "resume" &&
        process.argv[index + 1] === target.agent.thread,
    )
  )
    throw new Error(
      "Restarted process does not match the requested conversation",
    );
  if (!target.bypass.every((flag) => process.argv.includes(flag))) {
    throw new Error(
      "Wrapper did not preserve observed bypass flags; no continuation sent",
    );
  }
  if (target.nativeStatus) {
    await preservePausedGoal(runtime, target.session, target.agent.pane);
    const agent = await agentAt(runtime, target.session, target.agent.pane);
    if (agent?.terminal !== target.agent.terminal)
      throw new Error("Pane terminal changed during restart");
    const resumed = await probeConversation(
      runtime,
      target.session,
      agent,
      info,
    );
    if (!matches(resumed, target))
      throw new Error(
        "Native /status reported a different resumed conversation",
      );
    return resumed;
  }
  let resumed = await agentAt(runtime, target.session, target.agent.pane);
  if (resumed?.terminal !== target.agent.terminal)
    throw new Error("Pane terminal changed during restart");
  // Codex emits SessionStart only after its first turn. Publish the identity of
  // our verified exact-UUID resume so an idle pane remains eligible next time.
  if (resumed.thread === undefined) {
    await runtime.call(target.session, [
      "pane",
      "report-agent-session",
      target.agent.pane,
      "--source",
      string(target.agent.sessionSource),
      "--agent",
      "codex",
      "--agent-session-id",
      string(target.agent.thread),
    ]);
    resumed = await agentAt(runtime, target.session, target.agent.pane);
  }
  if (resumed === undefined || !matches(resumed, target))
    throw new Error(
      "Restarted pane did not report the expected conversation; no continuation sent",
    );
  return resumed;
}

async function continuePane(
  runtime: Runtime,
  target: Target,
  wasWorking: boolean,
  continued: Set<string>,
): Promise<string> {
  const resumed = await verifyLaunch(runtime, target);
  // Herdr requires a name to launch; restore an originally unnamed pane only
  // after confirming that the replacement is our exact conversation.
  if (target.agent.name === undefined)
    await runtime.call(target.session, [
      "agent",
      "rename",
      target.agent.pane,
      "--clear",
    ]);
  if (!wasWorking) return "Same conversation restored";
  const thread = string(target.agent.thread);
  if (continued.has(thread))
    return "Same conversation restored; continuation already handled";
  if (resumed.status === "working") {
    continued.add(thread);
    return "Existing turn is already working; no duplicate prompt sent";
  }
  if (resumed.status !== "idle" && resumed.status !== "done") {
    throw new Error(
      "Conversation restored but not ready for continuation; inspect pane",
    );
  }
  continued.add(thread);
  await runtime.call(target.session, [
    "agent",
    "prompt",
    target.agent.pane,
    continuation,
  ]);
  return "Same conversation restored; continuation submitted once";
}

async function waitForUnregistered(
  runtime: Runtime,
  target: Target,
): Promise<void> {
  const deadline = runtime.now() + 5000;
  while (runtime.now() < deadline) {
    if (!(await shellReady(runtime, target)))
      throw new Error("Codex foreground returned before restart");
    if (
      (await agentAt(runtime, target.session, target.agent.pane)) === undefined
    )
      return;
    await runtime.sleep(100);
  }
  throw new Error("Herdr did not unregister the exited agent within 5 seconds");
}

async function restoreName(runtime: Runtime, target: Target): Promise<void> {
  if (target.agent.name === undefined) return;
  const info = await processesAt(runtime, target.session, target.agent.pane);
  if (info.foreground !== target.pid || info.shell !== target.shell) return;
  if (
    !matches(await agentAt(runtime, target.session, target.agent.pane), target)
  )
    return;
  await runtime.call(target.session, [
    "agent",
    "rename",
    target.agent.pane,
    target.agent.name,
  ]);
}

export async function restart(
  runtime: Runtime,
  target: Target,
  continued = new Set<string>(),
): Promise<Outcome> {
  const { session, agent } = target;
  const outcome = (status: Outcome["status"], message: string): Outcome => ({
    session,
    pane: agent.pane,
    status,
    message,
  });
  try {
    let current = await agentAt(runtime, session, agent.pane);
    if (current !== undefined && target.nativeStatus) {
      const info = await processesAt(runtime, session, agent.pane);
      if (info.shell !== target.shell || info.foreground !== target.pid)
        return outcome("skipped", "Pane process changed before restart");
      current = await probeConversation(runtime, session, current, info);
    }
    if (!matches(current, target))
      return outcome("skipped", "Pane conversation changed before restart");
    // Use the last observed working state, not a potentially old discovery snapshot.
    const wasWorking = current?.status === "working";
    // Herdr can retain a persisted name reservation even when agent.list omits it.
    await runtime.call(session, ["agent", "rename", agent.pane, "--clear"]);
    await exitCodex(runtime, target);
    await waitForUnregistered(runtime, target);
    const startError = await launchReplacement(runtime, target);
    const message = await continuePane(
      runtime,
      target,
      wasWorking,
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
        : `${message}; Herdr launch acknowledgement failed but pane verified (${startError})`,
    );
  } catch (error) {
    try {
      await restoreName(runtime, target);
    } catch (restoreError) {
      return outcome(
        "failed",
        `${errorMessage(error)}; name restoration failed: ${errorMessage(restoreError)}`,
      );
    }
    return outcome("failed", errorMessage(error));
  }
}

export function runningSessions(value: unknown): string[] {
  return array(object(value).get("sessions")).flatMap((entry) => {
    const session = object(entry);
    const running = session.get("running");
    if (typeof running !== "boolean")
      throw new TypeError("Invalid Herdr session state");
    return running ? [string(session.get("name"))] : [];
  });
}
