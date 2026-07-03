/**
 * Shared subprocess-observability helpers used by every Temporal activity
 * that wraps a long-running `claude -p` / `codex exec` subprocess
 * (`runAgentTask`, the pr-babysit iteration loop, ...).
 *
 * The pieces of state captured here are the difference between "we know
 * what was happening when the agent died" and "we don't":
 *
 * - {@link OutputState} tracks the most recent output line (from EITHER
 *   stdout or stderr) + the longest stretch of silence within a run.
 *   `claude -p --output-format stream-json` writes its work to **stdout**
 *   (NDJSON) and is normally silent on stderr — so an idle detector that
 *   watched stderr alone was structurally blind (it reported zero idle on
 *   a fully wedged process). Both pumps now feed the same state.
 * - {@link computeSoftKillDelayMs} returns the delay (relative to
 *   subprocess spawn) at which the activity should send SIGINT to the
 *   subprocess so it can flush / dump pending tool state BEFORE Temporal's
 *   `startToCloseTimeout` SIGTERMs it. If the subprocess ignores SIGINT we
 *   escalate to SIGKILL after {@link SIGKILL_GRACE_MS} rather than burning
 *   the remaining wall waiting for Temporal's hard cancel.
 */

/**
 * Send SIGINT to the agent subprocess this many ms BEFORE Temporal's
 * activity `startToCloseTimeout` would SIGTERM it. 90 s is empirically
 * enough for `claude -p` to flush buffers and run its shutdown path
 * without overlapping the next 10 s heartbeat cycle.
 */
export const SOFT_KILL_BEFORE_MS = 90_000;

/**
 * After the soft-kill SIGINT fires, wait this long for the subprocess to
 * exit on its own before escalating to SIGKILL. `claude -p` has been
 * observed to ignore SIGINT entirely; without this escalation the run
 * burns the remaining ~90 s until Temporal's SIGTERM, holding a worker
 * slot for nothing.
 */
export const SIGKILL_GRACE_MS = 15_000;

/**
 * Per-run output observability state. Mutated in place by
 * {@link bumpOutputState} from BOTH the stdout and stderr pumps. Pass the
 * same instance to both pumps and the heartbeat closure (which reads
 * `lastLine`/`lastAt` to decide whether the subprocess is wedged).
 */
export type OutputState = {
  /** Most-recently observed output line (post-redaction), from stdout or
   * stderr. Empty before the subprocess has emitted anything. */
  lastLine: string;
  /** {@link Date.now}() at which `lastLine` was observed. Used to compute
   * idle time in heartbeats. */
  lastAt: number;
  /** Longest gap (ms) between successive output lines seen so far in this
   * run. The hang signal — a wedged tool call holds this open. */
  maxIdleMs: number;
  /** {@link Date.now}() of the FIRST output line, or `undefined` if the
   * subprocess never emitted anything. Distinguishes "hung at startup
   * before any output" from "streamed, then wedged". */
  firstOutputAt: number | undefined;
};

export function newOutputState(now: number): OutputState {
  return { lastLine: "", lastAt: now, maxIdleMs: 0, firstOutputAt: undefined };
}

/**
 * Record a new output line. Updates `lastLine`, `lastAt`, `maxIdleMs` (if
 * the gap since the previous line is larger than the running max), and
 * `firstOutputAt` (on the first line only).
 */
export function bumpOutputState(state: OutputState, line: string): void {
  const now = Date.now();
  const idleMs = now - state.lastAt;
  if (idleMs > state.maxIdleMs) {
    state.maxIdleMs = idleMs;
  }
  state.lastLine = line;
  state.lastAt = now;
  state.firstOutputAt ??= now;
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
 * Termination class for an agent subprocess run.
 *
 * - `"natural"` — subprocess exited on its own (success or non-zero).
 * - `"SIGINT"` — our soft-kill timer fired and the subprocess exited
 *   within the grace window.
 * - `"SIGKILL"` — the subprocess ignored SIGINT and we hard-killed it
 *   after {@link SIGKILL_GRACE_MS}.
 * - `"SIGTERM"` — Temporal cancelled the activity (which we forwarded to
 *   the subprocess with `proc.kill()`).
 */
export type AgentTerminationSignal =
  | "natural"
  | "SIGINT"
  | "SIGKILL"
  | "SIGTERM";

/** Per-tick payload passed to the heartbeat callback. */
export type AgentHeartbeat = {
  elapsedMs: number;
  /** Last output line (stdout or stderr), post-redaction. */
  lastLine: string;
  /** {@link Date.now}() of the last output line. */
  lastAt: number;
  /** ms since the last output line — grows without bound when wedged. */
  idleMs: number;
  /** False until the subprocess emits its first byte of output. */
  sawOutput: boolean;
};

/** Payload passed to the soft-kill callback the instant SIGINT fires. */
export type AgentSoftKill = {
  elapsedMs: number;
  lastLine: string;
  idleMs: number;
  maxIdleMs: number;
  startToCloseMs: number;
  sawOutput: boolean;
};

/** Payload passed to the SIGKILL-escalation callback when SIGINT is ignored. */
export type AgentSigkillEscalation = {
  elapsedMs: number;
  graceMs: number;
  lastLine: string;
};

/**
 * The terminal observation set produced by
 * {@link runTrackedAgentSubprocess}. Activity callers use these fields to
 * decide success/failure, emit per-activity metrics, and choose what to
 * attach to their span / Sentry capture.
 */
export type TrackedAgentResult = {
  /** Full raw (UN-redacted) stdout, for result parsing. */
  stdout: string;
  exitCode: number;
  durationMs: number;
  /** Longest silence gap, including the trailing gap from the last output
   * line to process exit. Equals `durationMs` when the subprocess never
   * emitted anything. */
  maxIdleMs: number;
  /** ms from spawn to the first output byte, or `undefined` if the
   * subprocess never emitted anything (hung before any output). */
  firstOutputLatencyMs: number | undefined;
  /** Last output line observed (stdout or stderr), post-redaction. */
  lastLine: string;
  signal: AgentTerminationSignal;
  softKillFired: boolean;
  sigkillEscalated: boolean;
};

export type TrackedAgentInput = {
  command: string[];
  cwd: string;
  env: Record<string, string>;
  /** Tokens (env values, app tokens, etc.) to redact from every output
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
  /** Grace period (ms) after the soft-kill SIGINT before escalating to
   * SIGKILL. Defaults to {@link SIGKILL_GRACE_MS}; overridable for tests. */
  sigkillGraceMs?: number;
  /** Invoked every heartbeat tick. Caller threads this into
   * {@link Context.current.heartbeat}, jsonLog, and the span. */
  onHeartbeat: (beat: AgentHeartbeat) => void;
  /** Invoked exactly once when the soft-kill SIGINT fires. Caller
   * threads this into jsonLog, the span, and the soft-kill counter. */
  onSoftKill: (event: AgentSoftKill) => void;
  /** Invoked once if the subprocess ignored SIGINT and we escalated to
   * SIGKILL. Caller threads this into jsonLog + a metric. */
  onSigkillEscalation?: (event: AgentSigkillEscalation) => void;
  /** Invoked for every (post-redaction) stdout line. For
   * `--output-format stream-json` this is one NDJSON event per line —
   * the live record of what the agent is actually doing. */
  onStdoutLine: (line: string) => void;
  /** Invoked for every (post-redaction) stderr line. */
  onStderrLine: (line: string) => void;
  /** Invoked once when Temporal cancellation requests a hard kill.
   * Caller threads this into jsonLog. */
  onCancellation: (state: { elapsedMs: number; lastLine: string }) => void;
};

/**
 * Pump a subprocess stream line-by-line: decode, split on newlines, redact
 * secrets, advance the shared {@link OutputState} idle clock, and hand each
 * line to `onLine`. Returns the full RAW (un-redacted) text so callers can
 * parse a structured result off stdout — redaction is applied only to the
 * per-line callback, never to the accumulated return value.
 */
async function pumpStreamToCallback(args: {
  stream: ReadableStream<Uint8Array>;
  redactTokens: readonly (string | undefined)[];
  state: OutputState;
  onLine: (line: string) => void;
  redact: (line: string, tokens: readonly (string | undefined)[]) => string;
}): Promise<string> {
  const { stream, redactTokens, state, onLine, redact } = args;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let raw = "";
  const flush = (line: string): void => {
    if (line.length === 0) {
      return;
    }
    const redacted = redact(line, redactTokens);
    bumpOutputState(state, redacted);
    onLine(redacted);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        flush(line);
      }
    }
  } finally {
    flush(buf);
  }
  return raw;
}

/**
 * Spawn a tracked agent subprocess and resolve when it exits.
 *
 * Owns: subprocess spawn, stdout + stderr line pumps (with redaction +
 * shared idle-time tracking), heartbeat timer, soft-kill timer with
 * SIGKILL escalation, Temporal cancellation wiring, terminal-signal
 * inference. Callers provide callbacks for each observable event so
 * activity-specific logging / metrics / span work stays where it belongs.
 */
export async function runTrackedAgentSubprocess(
  input: TrackedAgentInput,
  redactSecrets: (
    line: string,
    tokens: readonly (string | undefined)[],
  ) => string,
): Promise<TrackedAgentResult> {
  const startMs = Date.now();
  const outputState = newOutputState(startMs);
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
      lastLine: outputState.lastLine,
      lastAt: outputState.lastAt,
      idleMs: now - outputState.lastAt,
      sawOutput: outputState.firstOutputAt !== undefined,
    });
  }, input.heartbeatIntervalMs);

  const softKill = { fired: false };
  const sigkill = { fired: false };
  let sigkillTimer: ReturnType<typeof setTimeout> | undefined;
  const softKillDelayMs = computeSoftKillDelayMs(input.startToCloseTimeoutMs);
  const softKillTimer =
    softKillDelayMs === undefined
      ? undefined
      : setTimeout(() => {
          const now = Date.now();
          softKill.fired = true;
          input.onSoftKill({
            elapsedMs: now - startMs,
            lastLine: outputState.lastLine,
            idleMs: now - outputState.lastAt,
            maxIdleMs: outputState.maxIdleMs,
            startToCloseMs: input.startToCloseTimeoutMs ?? 0,
            sawOutput: outputState.firstOutputAt !== undefined,
          });
          proc.kill("SIGINT");
          // Escalate to SIGKILL if SIGINT is ignored within the grace window.
          const graceMs = input.sigkillGraceMs ?? SIGKILL_GRACE_MS;
          sigkillTimer = setTimeout(() => {
            sigkill.fired = true;
            input.onSigkillEscalation?.({
              elapsedMs: Date.now() - startMs,
              graceMs,
              lastLine: outputState.lastLine,
            });
            proc.kill("SIGKILL");
          }, graceMs);
        }, softKillDelayMs);

  const cancellationSignal = input.cancellationSignal;
  const abort = (): void => {
    input.onCancellation({
      elapsedMs: Date.now() - startMs,
      lastLine: outputState.lastLine,
    });
    proc.kill();
  };
  cancellationSignal?.addEventListener("abort", abort, { once: true });

  let stdout: string;
  let exitCode: number;
  try {
    [stdout, , exitCode] = await Promise.all([
      pumpStreamToCallback({
        stream: proc.stdout,
        redactTokens: input.redactTokens,
        state: outputState,
        onLine: input.onStdoutLine,
        redact: redactSecrets,
      }),
      pumpStreamToCallback({
        stream: proc.stderr,
        redactTokens: input.redactTokens,
        state: outputState,
        onLine: input.onStderrLine,
        redact: redactSecrets,
      }),
      proc.exited,
    ]);
  } finally {
    clearInterval(heartbeatTimer);
    if (softKillTimer !== undefined) {
      clearTimeout(softKillTimer);
    }
    if (sigkillTimer !== undefined) {
      clearTimeout(sigkillTimer);
    }
    cancellationSignal?.removeEventListener("abort", abort);
  }

  const endMs = Date.now();
  const durationMs = endMs - startMs;
  // Include the trailing gap (last output line → exit) so a "streamed
  // then wedged" run isn't undercounted, and a zero-output run reports
  // maxIdleMs === durationMs (lastAt is still startMs).
  const maxIdleMs = Math.max(outputState.maxIdleMs, endMs - outputState.lastAt);
  const firstOutputLatencyMs =
    outputState.firstOutputAt === undefined
      ? undefined
      : outputState.firstOutputAt - startMs;

  const cancelled = cancellationSignal?.aborted === true;
  const signal: AgentTerminationSignal = cancelled
    ? "SIGTERM"
    : sigkill.fired
      ? "SIGKILL"
      : softKill.fired
        ? "SIGINT"
        : "natural";

  return {
    stdout,
    exitCode,
    durationMs,
    maxIdleMs,
    firstOutputLatencyMs,
    lastLine: outputState.lastLine,
    signal,
    softKillFired: softKill.fired,
    sigkillEscalated: sigkill.fired,
  };
}
