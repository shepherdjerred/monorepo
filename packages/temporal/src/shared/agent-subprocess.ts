/**
 * Shared subprocess-observability helpers used by every Temporal activity
 * that wraps a long-running `claude -p` / `codex exec` subprocess
 * (`runAlertRemediationAgent`, `runAgentTask`, ...).
 *
 * The two pieces of state captured here are the difference between "we
 * know what was happening when the agent died" and "we don't":
 *
 * - {@link StderrState} tracks the most recent stderr line + the longest
 *   stretch of silence within a single run. Pairs with the heartbeat log
 *   (which emits these as fields every 10 s) and the per-run
 *   `agent_subprocess_idle_seconds` gauge.
 * - {@link computeSoftKillDelayMs} returns the delay (relative to
 *   subprocess spawn) at which the activity should send SIGINT to the
 *   subprocess so it can flush stderr / dump pending tool state BEFORE
 *   Temporal's `startToCloseTimeout` SIGTERMs it. SIGTERM kills before
 *   any flush; SIGINT lets `claude -p` exit gracefully. Returns
 *   `undefined` when no timely soft-kill is possible (the activity
 *   timeout is unset, or the safety margin would land the soft-kill at
 *   or before spawn).
 */

/**
 * Send SIGINT to the agent subprocess this many ms BEFORE Temporal's
 * activity `startToCloseTimeout` would SIGTERM it. 90 s is empirically
 * enough for `claude -p` to flush stderr buffers and run its shutdown
 * path without overlapping the next 10 s heartbeat cycle.
 */
export const SOFT_KILL_BEFORE_MS = 90_000;

/**
 * Per-run stderr observability state. Mutated in place by
 * {@link bumpStderrState}. Pass the same instance to the stderr pump
 * (which mutates it on every line) and the heartbeat closure (which
 * reads `lastStderrLine`/`lastStderrAt` to decide whether the subprocess
 * is wedged).
 */
export type StderrState = {
  /** Most-recently observed stderr line (post-redaction). Empty before
   * the subprocess has emitted anything. */
  lastStderrLine: string;
  /** {@link Date.now}() at which `lastStderrLine` was observed. Used to
   * compute idle time in heartbeats. */
  lastStderrAt: number;
  /** Longest gap (ms) between successive stderr lines seen so far in
   * this run. The hang signal — a wedged tool call holds this open. */
  maxIdleMs: number;
};

export function newStderrState(now: number): StderrState {
  return { lastStderrLine: "", lastStderrAt: now, maxIdleMs: 0 };
}

/**
 * Record a new stderr line. Updates `lastStderrLine`, `lastStderrAt`,
 * and `maxIdleMs` if the gap since the previous line is larger than the
 * running max.
 */
export function bumpStderrState(state: StderrState, line: string): void {
  const now = Date.now();
  const idleMs = now - state.lastStderrAt;
  if (idleMs > state.maxIdleMs) {
    state.maxIdleMs = idleMs;
  }
  state.lastStderrLine = line;
  state.lastStderrAt = now;
}

/**
 * Returns the delay (in ms from spawn) at which the soft-kill SIGINT
 * should fire. `undefined` means no soft-kill is scheduled — either the
 * activity timeout is unknown (local script driver) or the safety margin
 * would land the kill at or before spawn (timeout shorter than
 * {@link SOFT_KILL_BEFORE_MS}, which would imply the subprocess should
 * never have been launched on this activity in the first place).
 */
export function computeSoftKillDelayMs(
  startToCloseTimeoutMs: number | undefined,
): number | undefined {
  if (startToCloseTimeoutMs === undefined) {
    return undefined;
  }
  if (startToCloseTimeoutMs <= SOFT_KILL_BEFORE_MS) {
    return undefined;
  }
  return startToCloseTimeoutMs - SOFT_KILL_BEFORE_MS;
}

/**
 * Termination class for an agent subprocess run. Inferred from the
 * combination of (a) whether Temporal cancellation fired, (b) whether
 * our pre-emptive soft-kill fired, and (c) the actual exit code.
 *
 * - `"natural"` — subprocess exited on its own (success or non-zero).
 * - `"SIGINT"` — our soft-kill timer fired before the subprocess
 *   exited; the run reached the activity wall but we got a flush
 *   window.
 * - `"SIGTERM"` — Temporal cancelled the activity (which we forwarded
 *   to the subprocess with `proc.kill()`).
 */
export type AgentTerminationSignal = "natural" | "SIGINT" | "SIGTERM";

/** Per-tick payload passed to the heartbeat callback. */
export type AgentHeartbeat = {
  elapsedMs: number;
  lastStderrLine: string;
  lastStderrAt: number;
  idleMs: number;
};

/** Payload passed to the soft-kill callback the instant SIGINT fires. */
export type AgentSoftKill = {
  elapsedMs: number;
  lastStderrLine: string;
  idleMs: number;
  maxIdleMs: number;
  startToCloseMs: number;
};

/**
 * The terminal observation set produced by
 * {@link runTrackedAgentSubprocess}. Activity callers use these fields
 * to decide success/failure, emit per-activity metrics, and choose what
 * to attach to their span / Sentry capture.
 */
export type TrackedAgentResult = {
  stdout: string;
  exitCode: number;
  durationMs: number;
  maxIdleMs: number;
  lastStderrLine: string;
  signal: AgentTerminationSignal;
  softKillFired: boolean;
};

export type TrackedAgentInput = {
  command: string[];
  cwd: string;
  env: Record<string, string>;
  /** Tokens (env values, app tokens, etc.) to redact from every stderr
   * line before it's surfaced to the caller / logged. */
  redactTokens: readonly (string | undefined)[];
  /** Resolved via `Context.current().info.startToCloseTimeoutMs` by the
   * caller. `undefined` for local-script drivers where the soft-kill
   * step is skipped. */
  startToCloseTimeoutMs: number | undefined;
  /** Abort signal from `Context.current().cancellationSignal`. The
   * helper attaches a once-listener that hard-kills the subprocess
   * with `proc.kill()` (SIGTERM by default) on abort. */
  cancellationSignal: AbortSignal | undefined;
  /** Interval (ms) between heartbeat ticks. */
  heartbeatIntervalMs: number;
  /** Invoked every heartbeat tick. Caller threads this into
   * {@link Context.current.heartbeat}, jsonLog, and the span. */
  onHeartbeat: (beat: AgentHeartbeat) => void;
  /** Invoked exactly once when the soft-kill SIGINT fires. Caller
   * threads this into jsonLog, the span, and the soft-kill counter. */
  onSoftKill: (event: AgentSoftKill) => void;
  /** Invoked for every (post-redaction) stderr line. Caller threads
   * this into jsonLog. */
  onStderrLine: (line: string) => void;
  /** Invoked once when Temporal cancellation requests a hard kill.
   * Caller threads this into jsonLog. */
  onCancellation: (state: {
    elapsedMs: number;
    lastStderrLine: string;
  }) => void;
};

async function pumpStderrToCallback(args: {
  stream: ReadableStream<Uint8Array>;
  redactTokens: readonly (string | undefined)[];
  state: StderrState;
  onStderrLine: (line: string) => void;
  redact: (line: string, tokens: readonly (string | undefined)[]) => string;
}): Promise<void> {
  const { stream, redactTokens, state, onStderrLine, redact } = args;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) {
          continue;
        }
        const redacted = redact(line, redactTokens);
        bumpStderrState(state, redacted);
        onStderrLine(redacted);
      }
    }
  } finally {
    if (buf.length > 0) {
      const redacted = redact(buf, redactTokens);
      bumpStderrState(state, redacted);
      onStderrLine(redacted);
    }
  }
}

/**
 * Spawn a tracked agent subprocess and resolve when it exits.
 *
 * Owns: subprocess spawn, stderr-line pump (with redaction + idle-time
 * tracking), heartbeat timer, soft-kill timer, Temporal cancellation
 * wiring, terminal-signal inference. Callers provide callbacks for each
 * observable event so activity-specific logging / metrics / span work
 * stays where it belongs.
 */
export async function runTrackedAgentSubprocess(
  input: TrackedAgentInput,
  redactSecrets: (
    line: string,
    tokens: readonly (string | undefined)[],
  ) => string,
): Promise<TrackedAgentResult> {
  const startMs = Date.now();
  const stderrState = newStderrState(startMs);
  const proc = Bun.spawn(input.command, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: input.cwd,
    env: input.env,
  });

  const heartbeatTimer = setInterval(() => {
    const now = Date.now();
    input.onHeartbeat({
      elapsedMs: now - startMs,
      lastStderrLine: stderrState.lastStderrLine,
      lastStderrAt: stderrState.lastStderrAt,
      idleMs: now - stderrState.lastStderrAt,
    });
  }, input.heartbeatIntervalMs);

  const softKill = { fired: false };
  const softKillDelayMs = computeSoftKillDelayMs(input.startToCloseTimeoutMs);
  const softKillTimer =
    softKillDelayMs === undefined
      ? undefined
      : setTimeout(() => {
          const now = Date.now();
          const elapsedMs = now - startMs;
          const idleMs = now - stderrState.lastStderrAt;
          softKill.fired = true;
          input.onSoftKill({
            elapsedMs,
            lastStderrLine: stderrState.lastStderrLine,
            idleMs,
            maxIdleMs: stderrState.maxIdleMs,
            startToCloseMs: input.startToCloseTimeoutMs ?? 0,
          });
          proc.kill("SIGINT");
        }, softKillDelayMs);

  const cancellationSignal = input.cancellationSignal;
  const abort = (): void => {
    input.onCancellation({
      elapsedMs: Date.now() - startMs,
      lastStderrLine: stderrState.lastStderrLine,
    });
    proc.kill();
  };
  cancellationSignal?.addEventListener("abort", abort, { once: true });

  let stdout: string;
  let exitCode: number;
  try {
    [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      pumpStderrToCallback({
        stream: proc.stderr,
        redactTokens: input.redactTokens,
        state: stderrState,
        onStderrLine: input.onStderrLine,
        redact: redactSecrets,
      }),
      proc.exited,
    ]);
  } finally {
    clearInterval(heartbeatTimer);
    if (softKillTimer !== undefined) {
      clearTimeout(softKillTimer);
    }
    cancellationSignal?.removeEventListener("abort", abort);
  }

  const durationMs = Date.now() - startMs;
  const cancelled = cancellationSignal?.aborted === true;
  const signal: AgentTerminationSignal = cancelled
    ? "SIGTERM"
    : softKill.fired
      ? "SIGINT"
      : "natural";

  return {
    stdout,
    exitCode,
    durationMs,
    maxIdleMs: stderrState.maxIdleMs,
    lastStderrLine: stderrState.lastStderrLine,
    signal,
    softKillFired: softKill.fired,
  };
}
