/**
 * Verifier runtime implementations for the Phase 4 verification activity.
 *
 * The `VerifierRunner` interface lets the activity be tested with a
 * canned-result fake while production uses `makeBunSpawnVerifierRunner`
 * to actually exec typecheck / eslint / grep / test subprocesses against
 * the bootstrap workdir.
 *
 * Split out of `verify.ts` because the runner implementations + helpers
 * dominate the line count there; `verify.ts` keeps the
 * dispatcher / activity wrapper / drop logic. Tests import everything they
 * need from this file directly.
 */

import * as Sentry from "@sentry/bun";
import type {
  FindingVerifier,
  VerificationResult,
  VerificationStatus,
  VerifierTarget,
} from "#shared/pr-review/finding.ts";

/**
 * Maximum wall-clock duration for a single verifier subprocess. Findings
 * whose verifier doesn't finish in time are kept as `unverified`.
 */
export const VERIFIER_TIMEOUT_MS = 60_000;

/**
 * Maximum stdout/stderr bytes captured per verifier. Anything past this is
 * truncated in the excerpt. We don't need the full output — the verifier
 * decision is the load-bearing bit; the excerpt is debug-only.
 */
const MAX_OUTPUT_BYTES = 16 * 1024;

/**
 * Maximum number of chars in the `outputExcerpt` field of a
 * `VerificationResult`. The schema caps at 1000; we leave headroom.
 */
const MAX_EXCERPT_CHARS = 900;

/**
 * Injectable verifier runtime. Tests supply a fake that returns canned
 * results; production uses `makeBunSpawnVerifierRunner` against the
 * bootstrap workdir.
 *
 * Each method runs exactly the verifier kind it advertises and returns a
 * structured result. Methods are NEVER allowed to throw — they catch all
 * subprocess errors and report `unverified` with a `note`. The activity
 * relies on this so verifier failures can't crash the workflow.
 */
export type VerifierRunner = {
  typecheck: (
    target: Extract<VerifierTarget, { kind: "typecheck" }>,
  ) => Promise<VerificationResult>;
  eslint: (
    target: Extract<VerifierTarget, { kind: "eslint" }>,
  ) => Promise<VerificationResult>;
  grep: (
    target: Extract<VerifierTarget, { kind: "grep" }>,
  ) => Promise<VerificationResult>;
  test: (
    target: Extract<VerifierTarget, { kind: "test" }>,
  ) => Promise<VerificationResult>;
};

/**
 * Truncates verifier output to fit the `outputExcerpt` field of a
 * `VerificationResult`. Trims whitespace and appends a clear marker if
 * the input exceeds the cap.
 */
export function truncateExcerpt(output: string): string {
  const trimmed = output.trim();
  if (trimmed.length <= MAX_EXCERPT_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_EXCERPT_CHARS)}\n…(truncated, ${String(trimmed.length - MAX_EXCERPT_CHARS)} more chars)`;
}

/**
 * Build a fresh `VerificationResult` shape with the common fields filled in.
 * Reduces boilerplate in each verifier runner.
 */
export function makeVerificationResult(input: {
  status: VerificationStatus;
  verifier: FindingVerifier;
  exitCode: number;
  output: string;
  durationMs: number;
  note?: string;
}): VerificationResult {
  return {
    status: input.status,
    verifier: input.verifier,
    exitCode: input.exitCode,
    outputExcerpt: truncateExcerpt(input.output),
    durationMs: input.durationMs,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

/**
 * Wrapper around `Bun.spawn` with the exact piped-stdio options shape we
 * use everywhere. Extracted as a top-level function so TypeScript keeps
 * the literal-narrowed return type (`proc.stdout: ReadableStream<Uint8Array>`)
 * instead of widening it to `number | ReadableStream | undefined` — the
 * widening happens when you write `let proc: ReturnType<typeof Bun.spawn>`
 * because that drops the option narrowing.
 */
function spawnPiped(cmd: string[], cwd: string) {
  return Bun.spawn(cmd, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, CI: "1" },
  });
}

/**
 * Result of `spawnWithTimeout`. Distinct from `VerificationResult` — the
 * caller (the verifier runner) maps this tuple onto a `VerificationResult`
 * after applying its own decision logic.
 */
type SpawnOutcome = {
  exitCode: number;
  output: string;
  timedOut: boolean;
  errored: boolean;
  durationMs: number;
};

/**
 * Spawn a subprocess with a hard wall-clock timeout. Returns the
 * `{exitCode, output, timedOut, errored, durationMs}` tuple verifier
 * runners use to classify the result.
 *
 * `output` is the merged stdout+stderr (truncated to `MAX_OUTPUT_BYTES`).
 * `errored` is true if the subprocess threw at spawn-time (binary missing,
 * cwd missing, permission denied). `timedOut` is true if the wall-clock
 * deadline fired before the process exited.
 *
 * Never throws — all subprocess errors are reflected in the returned tuple.
 */
export async function spawnWithTimeout(input: {
  cmd: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<SpawnOutcome> {
  const startMs = Date.now();
  // Spawn inline — declaring `let proc: ReturnType<typeof Bun.spawn>` first
  // widens the type and loses the literal-option narrowing that makes
  // `proc.stdout` a ReadableStream (Bun's typing depends on the
  // `stdout: "pipe"` literal). Match the pr-agent.ts pattern.
  const procResult = (():
    | { ok: true; proc: ReturnType<typeof spawnPiped> }
    | { ok: false; output: string } => {
    try {
      return { ok: true, proc: spawnPiped(input.cmd, input.cwd) };
    } catch (error: unknown) {
      return {
        ok: false,
        output: error instanceof Error ? error.message : String(error),
      };
    }
  })();
  if (!procResult.ok) {
    return {
      exitCode: -1,
      output: procResult.output,
      timedOut: false,
      errored: true,
      durationMs: Date.now() - startMs,
    };
  }
  const { proc } = procResult;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, input.timeoutMs);

  let exitCode: number;
  let output = "";
  try {
    // `stdout: "pipe", stderr: "pipe"` above guarantees stdout/stderr are
    // ReadableStream<Uint8Array>; `new Response(...)` accepts that and the
    // same pattern is used in pr-agent.ts. We bound the captured output to
    // MAX_OUTPUT_BYTES post-hoc since verifier outputs at this scale
    // (60s-bounded subprocesses) are well within the limit in practice.
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    output = `${stdout}\n${stderr}`;
    if (output.length > MAX_OUTPUT_BYTES) {
      output = `${output.slice(0, MAX_OUTPUT_BYTES)}\n…(truncated)`;
    }
    exitCode = code;
  } catch (error: unknown) {
    // Defensive: stream draining should not fail, but if it does we want
    // the verifier to record `unverified` rather than crash the workflow.
    Sentry.captureException(error);
    return {
      exitCode: -1,
      output: error instanceof Error ? error.message : String(error),
      timedOut,
      errored: true,
      durationMs: Date.now() - startMs,
    };
  } finally {
    clearTimeout(timer);
  }

  return {
    exitCode,
    output,
    timedOut,
    errored: false,
    durationMs: Date.now() - startMs,
  };
}

/**
 * Helper that turns a `SpawnOutcome` into one of the common
 * `unverified`-with-note shapes the runners reach for repeatedly
 * (timeout, spawn-failed). Returns `undefined` when neither edge fired,
 * leaving the runner to apply its own decision logic.
 */
function classifyOutcomeEdges(input: {
  outcome: SpawnOutcome;
  verifier: FindingVerifier;
}): VerificationResult | undefined {
  const { outcome, verifier } = input;
  if (outcome.timedOut) {
    return makeVerificationResult({
      status: "unverified",
      verifier,
      exitCode: outcome.exitCode,
      output: outcome.output,
      durationMs: outcome.durationMs,
      note: `timed out after ${String(VERIFIER_TIMEOUT_MS)}ms`,
    });
  }
  if (outcome.errored) {
    return makeVerificationResult({
      status: "unverified",
      verifier,
      exitCode: -1,
      output: outcome.output,
      durationMs: outcome.durationMs,
      note: "verifier spawn failed",
    });
  }
  return undefined;
}

/**
 * Production verifier runner that runs each check as a `Bun.spawn`
 * subprocess in `workdir`. Each method is total — it returns a
 * `VerificationResult` for every input rather than throwing.
 *
 * Decision logic per verifier:
 *   - typecheck: `bun run typecheck` in `packagePath`. If
 *     `expectedOutputSubstring` appears in output → `verified`; if exit 0
 *     and substring missing → `contradicted`; otherwise → `unverified`.
 *   - eslint: `bunx eslint <filePath> --format json --rule "<ruleId>: error"`.
 *     If the rule fires (exit 1 + ruleId in output) → `verified`; if clean
 *     (exit 0) → `contradicted`; config error (exit 2) → `unverified`.
 *   - grep: `rg --json <pattern> <pathGlob>`. Match found ↔ `mustMatch`
 *     gives the verdict; rg error (exit 2) → `unverified`.
 *   - test: `bun test --testNamePattern <pattern>` in `packagePath`. Exit
 *     code matched against `expectPass`.
 *
 * When `workdir` is empty, returns a runner that always reports
 * `unverified` — Phase 1/2 stub-bootstrap mode.
 */
export function makeBunSpawnVerifierRunner(workdir: string): VerifierRunner {
  if (workdir === "") {
    return makeUnavailableRunner("workdir unavailable (bootstrap stub mode)");
  }

  return {
    typecheck: async (target) => {
      const outcome = await spawnWithTimeout({
        cmd: ["bun", "run", "typecheck"],
        cwd: `${workdir}/${target.packagePath}`,
        timeoutMs: VERIFIER_TIMEOUT_MS,
      });
      const edge = classifyOutcomeEdges({ outcome, verifier: "typecheck" });
      if (edge !== undefined) return edge;

      const found = outcome.output.includes(target.expectedOutputSubstring);
      if (found) {
        return makeVerificationResult({
          status: "verified",
          verifier: "typecheck",
          exitCode: outcome.exitCode,
          output: outcome.output,
          durationMs: outcome.durationMs,
        });
      }
      if (outcome.exitCode === 0) {
        return makeVerificationResult({
          status: "contradicted",
          verifier: "typecheck",
          exitCode: outcome.exitCode,
          output: outcome.output,
          durationMs: outcome.durationMs,
          note: `typecheck passed; expected substring "${target.expectedOutputSubstring}" not present`,
        });
      }
      return makeVerificationResult({
        status: "unverified",
        verifier: "typecheck",
        exitCode: outcome.exitCode,
        output: outcome.output,
        durationMs: outcome.durationMs,
        note: "typecheck failed but expected substring not present in output",
      });
    },

    eslint: async (target) => {
      const outcome = await spawnWithTimeout({
        cmd: [
          "bunx",
          "eslint",
          target.filePath,
          "--format",
          "json",
          "--rule",
          `${target.ruleId}: error`,
        ],
        cwd: workdir,
        timeoutMs: VERIFIER_TIMEOUT_MS,
      });
      const edge = classifyOutcomeEdges({ outcome, verifier: "eslint" });
      if (edge !== undefined) return edge;

      // ESLint exits 0 (clean), 1 (rule violations), or 2 (config error).
      if (outcome.exitCode === 2) {
        return makeVerificationResult({
          status: "unverified",
          verifier: "eslint",
          exitCode: outcome.exitCode,
          output: outcome.output,
          durationMs: outcome.durationMs,
          note: "eslint configuration error",
        });
      }
      if (outcome.exitCode === 0) {
        return makeVerificationResult({
          status: "contradicted",
          verifier: "eslint",
          exitCode: outcome.exitCode,
          output: outcome.output,
          durationMs: outcome.durationMs,
          note: `rule ${target.ruleId} did not fire on ${target.filePath}`,
        });
      }
      const mentionsRule = outcome.output.includes(target.ruleId);
      return makeVerificationResult({
        status: mentionsRule ? "verified" : "unverified",
        verifier: "eslint",
        exitCode: outcome.exitCode,
        output: outcome.output,
        durationMs: outcome.durationMs,
        ...(mentionsRule
          ? {}
          : { note: `eslint failed but rule ${target.ruleId} not mentioned` }),
      });
    },

    grep: async (target) => {
      const args = ["rg", "--json", "--glob", target.pathGlob];
      if (target.isLiteral) args.splice(1, 0, "-F");
      args.push(target.pattern);
      const outcome = await spawnWithTimeout({
        cmd: args,
        cwd: workdir,
        timeoutMs: VERIFIER_TIMEOUT_MS,
      });
      const edge = classifyOutcomeEdges({ outcome, verifier: "grep" });
      if (edge !== undefined) return edge;

      // ripgrep exits 0 with match, 1 without, 2 on error.
      if (outcome.exitCode === 2) {
        return makeVerificationResult({
          status: "unverified",
          verifier: "grep",
          exitCode: outcome.exitCode,
          output: outcome.output,
          durationMs: outcome.durationMs,
          note: "ripgrep error (invalid pattern, missing path, etc.)",
        });
      }
      const matched = outcome.exitCode === 0;
      const claimSupported = matched === target.mustMatch;
      return makeVerificationResult({
        status: claimSupported ? "verified" : "contradicted",
        verifier: "grep",
        exitCode: outcome.exitCode,
        output: outcome.output,
        durationMs: outcome.durationMs,
        ...(claimSupported
          ? {}
          : {
              note: target.mustMatch
                ? "pattern not found"
                : "pattern unexpectedly present",
            }),
      });
    },

    test: async (target) => {
      const outcome = await spawnWithTimeout({
        cmd: ["bun", "test", "--testNamePattern", target.testNamePattern],
        cwd: `${workdir}/${target.packagePath}`,
        timeoutMs: VERIFIER_TIMEOUT_MS,
      });
      const edge = classifyOutcomeEdges({ outcome, verifier: "test" });
      if (edge !== undefined) return edge;

      const passed = outcome.exitCode === 0;
      const claimSupported = passed === target.expectPass;
      return makeVerificationResult({
        status: claimSupported ? "verified" : "contradicted",
        verifier: "test",
        exitCode: outcome.exitCode,
        output: outcome.output,
        durationMs: outcome.durationMs,
        ...(claimSupported
          ? {}
          : {
              note: target.expectPass
                ? "test failed; claim asserted it would pass"
                : "test passed; claim asserted it would fail",
            }),
      });
    },
  };
}

function makeUnavailableRunner(reason: string): VerifierRunner {
  const result = (verifier: FindingVerifier): VerificationResult =>
    makeVerificationResult({
      status: "unverified",
      verifier,
      exitCode: -1,
      output: "",
      durationMs: 0,
      note: reason,
    });
  return {
    typecheck: () => Promise.resolve(result("typecheck")),
    eslint: () => Promise.resolve(result("eslint")),
    grep: () => Promise.resolve(result("grep")),
    test: () => Promise.resolve(result("test")),
  };
}
