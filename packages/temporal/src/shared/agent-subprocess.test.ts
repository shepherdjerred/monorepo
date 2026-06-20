import { describe, expect, it } from "bun:test";
import {
  SOFT_KILL_BEFORE_MS,
  bumpOutputState,
  computeSoftKillDelayMs,
  newOutputState,
  runTrackedAgentSubprocess,
  type AgentHeartbeat,
  type AgentSigkillEscalation,
  type AgentSoftKill,
  type TrackedAgentInput,
} from "./agent-subprocess.ts";

const noRedact = (line: string): string => line;

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }
  return env;
}

/** Build a TrackedAgentInput with no-op callbacks + capture arrays. */
function harness(
  command: string[],
  overrides: Partial<TrackedAgentInput> = {},
): {
  input: TrackedAgentInput;
  stdoutLines: string[];
  stderrLines: string[];
  softKills: AgentSoftKill[];
  sigkills: AgentSigkillEscalation[];
  heartbeats: AgentHeartbeat[];
} {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const softKills: AgentSoftKill[] = [];
  const sigkills: AgentSigkillEscalation[] = [];
  const heartbeats: AgentHeartbeat[] = [];
  const input: TrackedAgentInput = {
    command,
    cwd: process.cwd(),
    env: cleanEnv(),
    redactTokens: [],
    startToCloseTimeoutMs: undefined,
    cancellationSignal: undefined,
    heartbeatIntervalMs: 5000,
    onHeartbeat: (beat) => heartbeats.push(beat),
    onSoftKill: (e) => softKills.push(e),
    onSigkillEscalation: (e) => sigkills.push(e),
    onStdoutLine: (line) => stdoutLines.push(line),
    onStderrLine: (line) => stderrLines.push(line),
    onCancellation: (state) => stderrLines.push(state.lastLine),
    ...overrides,
  };
  return { input, stdoutLines, stderrLines, softKills, sigkills, heartbeats };
}

describe("computeSoftKillDelayMs", () => {
  it("returns delay = timeout - safety margin for a realistic 30-min wall", () => {
    const thirtyMinMs = 30 * 60 * 1000;
    expect(computeSoftKillDelayMs(thirtyMinMs)).toBe(
      thirtyMinMs - SOFT_KILL_BEFORE_MS,
    );
  });

  it("returns undefined when the activity has no startToCloseTimeout (local script driver)", () => {
    const noTimeout: number | undefined = undefined;
    expect(computeSoftKillDelayMs(noTimeout)).toBeUndefined();
  });

  it("returns undefined when the timeout equals the safety margin (no time to soft-kill)", () => {
    expect(computeSoftKillDelayMs(SOFT_KILL_BEFORE_MS)).toBeUndefined();
  });

  it("returns undefined when the timeout is shorter than the safety margin", () => {
    expect(computeSoftKillDelayMs(60_000)).toBeUndefined();
  });
});

describe("OutputState tracking", () => {
  it("initializes empty, no idle, no first-output timestamp", () => {
    const state = newOutputState(1000);
    expect(state.lastLine).toBe("");
    expect(state.lastAt).toBe(1000);
    expect(state.maxIdleMs).toBe(0);
    expect(state.firstOutputAt).toBeUndefined();
  });

  it("records the most recent line and stamps firstOutputAt once", () => {
    const state = newOutputState(Date.now());
    bumpOutputState(state, "first line");
    const firstAt = state.firstOutputAt;
    expect(state.lastLine).toBe("first line");
    expect(firstAt).toBeDefined();
    bumpOutputState(state, "second line");
    expect(state.lastLine).toBe("second line");
    // firstOutputAt is sticky — only the first line sets it.
    expect(state.firstOutputAt).toBe(firstAt);
  });

  it("tracks the longest silence gap as the running maxIdleMs", async () => {
    const state = newOutputState(Date.now());
    bumpOutputState(state, "early line");
    const firstIdle = state.maxIdleMs;
    await new Promise((resolve) => setTimeout(resolve, 50));
    bumpOutputState(state, "after gap");
    expect(state.maxIdleMs).toBeGreaterThan(firstIdle);
    expect(state.maxIdleMs).toBeGreaterThanOrEqual(40);
  });

  it("does not regress maxIdleMs when a later gap is smaller", async () => {
    const state = newOutputState(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 60));
    bumpOutputState(state, "after long gap");
    const longestSoFar = state.maxIdleMs;
    expect(longestSoFar).toBeGreaterThanOrEqual(50);
    await new Promise((resolve) => setTimeout(resolve, 10));
    bumpOutputState(state, "after short gap");
    expect(state.maxIdleMs).toBe(longestSoFar);
  });
});

describe("runTrackedAgentSubprocess", () => {
  it("streams stdout NDJSON lines and accumulates raw stdout for parsing", async () => {
    const script = [
      String.raw`process.stdout.write('{"type":"system","subtype":"init"}\n');`,
      String.raw`process.stdout.write('{"type":"assistant"}\n');`,
      String.raw`process.stdout.write('{"type":"result","subtype":"success","result":"ok"}\n');`,
    ].join("");
    const { input, stdoutLines } = harness(["bun", "-e", script]);
    const result = await runTrackedAgentSubprocess(input, noRedact);

    expect(result.exitCode).toBe(0);
    expect(result.signal).toBe("natural");
    expect(stdoutLines).toHaveLength(3);
    expect(stdoutLines[2]).toContain('"type":"result"');
    expect(result.stdout).toContain('"result":"ok"');
    expect(result.firstOutputLatencyMs).toBeTypeOf("number");
    expect(result.sigkillEscalated).toBe(false);
    expect(result.softKillFired).toBe(false);
  });

  it("reports firstOutputLatencyMs=undefined and maxIdleMs≈duration for a silent run", async () => {
    const { input, stdoutLines } = harness([
      "bun",
      "-e",
      "await Bun.sleep(60);",
    ]);
    const result = await runTrackedAgentSubprocess(input, noRedact);

    expect(result.exitCode).toBe(0);
    expect(stdoutLines).toHaveLength(0);
    expect(result.firstOutputLatencyMs).toBeUndefined();
    // No output ever → the whole run counts as one silent stretch.
    expect(result.maxIdleMs).toBeGreaterThanOrEqual(40);
    expect(result.maxIdleMs).toBeLessThanOrEqual(result.durationMs + 5);
  });

  it("escalates to SIGKILL when the subprocess ignores the soft-kill SIGINT", async () => {
    // Soft-kill fires at startToCloseTimeoutMs - SOFT_KILL_BEFORE_MS.
    const { input, softKills, sigkills } = harness(
      [
        "bun",
        "-e",
        "process.on('SIGINT', () => {}); setInterval(() => {}, 1e6);",
      ],
      {
        startToCloseTimeoutMs: SOFT_KILL_BEFORE_MS + 150,
        sigkillGraceMs: 200,
      },
    );
    const result = await runTrackedAgentSubprocess(input, noRedact);

    expect(result.softKillFired).toBe(true);
    expect(result.sigkillEscalated).toBe(true);
    expect(result.signal).toBe("SIGKILL");
    expect(softKills).toHaveLength(1);
    expect(sigkills).toHaveLength(1);
    expect(sigkills[0]?.graceMs).toBe(200);
  }, 10_000);
});
