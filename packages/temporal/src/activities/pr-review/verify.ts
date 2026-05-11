/**
 * Empirical verification activity (Phase 4 of the SOTA pr-review bot —
 * `packages/docs/plans/2026-05-10_sota-pr-review-bot.md`).
 *
 * # What it does
 *
 * For each post-consensus `Finding`, runs the verifier the specialist
 * declared (`typecheck` / `eslint` / `grep` / `test` / `none`) against the
 * PR head and uses the verifier's output to keep, drop, or flag the
 * finding:
 *
 *   - verifier output supports the claim → keep + mark `verified`
 *   - verifier output contradicts the claim → DROP the finding
 *   - verifier errored / timed out / no `verifierTarget` declared → keep
 *     + mark `unverified`. **Never let verifier failures hide bugs.**
 *
 * This is the single biggest FPR reducer in the SOTA stack per the audit
 * (CodeRabbit agentic validation, Cursor BugBot v11). Hallucinated-claim
 * findings citing nonexistent symbols/files get dropped here regardless of
 * how confidently the model emitted them.
 *
 * # File layout
 *
 * This file owns the activity wrapper, the per-finding dispatcher
 * (`verifyOneFinding`), and the drop-or-keep loop (`runVerifyFindings`).
 * The verifier runtime implementations live in `./verify-runner.ts` —
 * extracted to keep this file under the 500-line lint cap and to make
 * the runner contract independently importable by tests + the replay CLI.
 *
 * # Per-finding parallelism + timeout
 *
 * Findings are verified concurrently via `Promise.allSettled`. Each
 * verifier subprocess gets a hard 60s wall-clock timeout. Per the plan:
 * timeouts → `unverified` (not contradicted). The full activity gets a
 * 10-minute startToCloseTimeout from the workflow.
 */

import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { withSpan } from "#observability/tracing.ts";
import { prReviewVerifyFindingsTotal } from "#observability/metrics.ts";
import type { Finding, VerificationResult } from "#shared/pr-review/finding.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import {
  makeBunSpawnVerifierRunner,
  makeVerificationResult,
  type VerifierRunner,
} from "./verify-runner.ts";

const COMPONENT = "pr-review-pipeline";

export type VerifyFindingsInput = {
  findings: Finding[];
  /** Bootstrap workdir (PR-head checkout). Empty until Phase 5+. */
  workdir: string;
};

/**
 * Extract a string message from an `unknown` error. Standard
 * `instanceof Error` ladder, factored out so we don't repeat it everywhere.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      activity: "verifyFindings",
      ...fields,
    }),
  );
}

function captureWithContext(
  error: unknown,
  finding: Finding,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    scope.setTag("verifier", finding.verifier);
    // `Context.current()` throws when called outside a running Temporal
    // activity (e.g. unit tests, the replay CLI). Best-effort: if context
    // is available, enrich the scope; otherwise skip the workflow tags
    // and still capture the exception so it lands in Sentry/Bugsink.
    const ctxFields: Record<string, unknown> = {
      findingId: finding.id,
      file: finding.file,
      verifier: finding.verifier,
      ...extra,
    };
    try {
      const info = Context.current().info;
      scope.setTag("workflow", info.workflowType);
      scope.setTag("activity", info.activityType);
      Object.assign(ctxFields, workflowExecutionContext(info));
      ctxFields["attempt"] = info.attempt;
    } catch {
      /* not inside a Temporal activity — proceed without workflow tags */
    }
    scope.setContext("verifyFinding", ctxFields);
    Sentry.captureException(error);
  });
}

/**
 * Verify a single finding. Dispatches on the declared `verifier` /
 * `verifierTarget` shape; returns a verification result. Never throws.
 *
 * Public so tests + the replay CLI can verify findings one at a time
 * without spinning up the full activity.
 */
export async function verifyOneFinding(
  runner: VerifierRunner,
  finding: Finding,
): Promise<VerificationResult> {
  // `verifier === "none"` — no empirical check; finding rides on consensus alone.
  if (finding.verifier === "none") {
    return makeVerificationResult({
      status: "unverified",
      verifier: "none",
      exitCode: 0,
      output: "",
      durationMs: 0,
      note: "specialist declared no verifier",
    });
  }

  // Missing `verifierTarget` — older Phase 2/3 outputs may not have it. Keep
  // as unverified rather than dropping, since the specialist clearly
  // intended to flag something.
  const target = finding.verifierTarget;
  if (target === undefined) {
    return makeVerificationResult({
      status: "unverified",
      verifier: finding.verifier,
      exitCode: 0,
      output: "",
      durationMs: 0,
      note: "specialist did not supply verifierTarget params",
    });
  }

  // Discriminator mismatch — the model declared `verifier: "grep"` but
  // emitted a `verifierTarget.kind: "test"`. Schema refinement should
  // catch this at parse time, but defend against runtime drift.
  if (target.kind !== finding.verifier) {
    return makeVerificationResult({
      status: "unverified",
      verifier: finding.verifier,
      exitCode: 0,
      output: "",
      durationMs: 0,
      note: `verifierTarget.kind="${target.kind}" disagrees with verifier="${finding.verifier}"`,
    });
  }

  try {
    // `target.kind` is narrowed to "typecheck"|"eslint"|"grep"|"test"
    // here: the early `verifier === "none"` return excludes that branch,
    // and the discriminator-mismatch guard above ensures
    // `target.kind === finding.verifier`. The exhaustive switch below
    // covers all four remaining cases.
    switch (target.kind) {
      case "typecheck":
        return await runner.typecheck(target);
      case "eslint":
        return await runner.eslint(target);
      case "grep":
        return await runner.grep(target);
      case "test":
        return await runner.test(target);
    }
  } catch (error: unknown) {
    // Runners are documented as total but a programmer error in a fake
    // could still throw — capture + report unverified rather than fail
    // the whole activity.
    captureWithContext(error, finding);
    return makeVerificationResult({
      status: "unverified",
      verifier: finding.verifier,
      exitCode: -1,
      output: errorMessage(error),
      durationMs: 0,
      note: "verifier runner threw (programmer error in injected runner)",
    });
  }
}

type PerFindingVerification = {
  finding: Finding;
  verification: VerificationResult;
};

/**
 * Pure runner — takes the injected `VerifierRunner` and the consensus
 * output, returns the post-verification finding list. Contradicted
 * findings are filtered out; verified and unverified pass through with
 * their `verification` field populated.
 *
 * Exported separately from the Temporal activity so tests can drive it
 * with a fake runner without involving the Temporal SDK.
 */
export async function runVerifyFindings(
  runner: VerifierRunner,
  findings: readonly Finding[],
): Promise<Finding[]> {
  // Verify in parallel; per-finding errors are absorbed by `verifyOneFinding`,
  // so `allSettled` is defense-in-depth rather than required.
  const results = await Promise.allSettled(
    findings.map(
      async (finding): Promise<PerFindingVerification> => ({
        finding,
        verification: await verifyOneFinding(runner, finding),
      }),
    ),
  );

  const kept: Finding[] = [];
  let droppedCount = 0;
  let verifiedCount = 0;
  let unverifiedCount = 0;
  for (const [i, r] of results.entries()) {
    const original = findings[i];
    if (original === undefined) continue;
    if (r.status === "rejected") {
      // Should be unreachable — verifyOneFinding never throws. If it does,
      // surface the finding as unverified so we never silently drop.
      const reasonMessage = errorMessage(r.reason);
      jsonLog("warning", "verifyOneFinding rejected (defense-in-depth)", {
        findingId: original.id,
        error: reasonMessage,
      });
      kept.push({
        ...original,
        verification: makeVerificationResult({
          status: "unverified",
          verifier: original.verifier,
          exitCode: -1,
          output: reasonMessage,
          durationMs: 0,
          note: "verifyOneFinding rejected unexpectedly",
        }),
      });
      unverifiedCount++;
      prReviewVerifyFindingsTotal.inc({
        verifier: original.verifier,
        outcome: "unverified",
      });
      continue;
    }
    const { finding, verification } = r.value;
    prReviewVerifyFindingsTotal.inc({
      verifier: finding.verifier,
      outcome: verification.status,
    });
    if (verification.status === "contradicted") {
      droppedCount++;
      jsonLog("info", "verification dropped contradicted finding", {
        findingId: finding.id,
        file: finding.file,
        verifier: finding.verifier,
        note: verification.note,
      });
      continue;
    }
    if (verification.status === "verified") verifiedCount++;
    else unverifiedCount++;
    kept.push({ ...finding, verification });
  }

  jsonLog("info", "verifyFindings completed", {
    inputCount: findings.length,
    verifiedCount,
    unverifiedCount,
    droppedCount,
  });

  return kept;
}

async function verifyFindingsImpl(
  input: VerifyFindingsInput,
): Promise<Finding[]> {
  return await withSpan(
    "prReview.verifyFindings",
    {
      "findings.input": input.findings.length,
      "workdir.present": input.workdir !== "",
    },
    async () => {
      const runner = makeBunSpawnVerifierRunner(input.workdir);
      return await runVerifyFindings(runner, input.findings);
    },
  );
}

export type VerifyActivities = typeof verifyActivities;

export const verifyActivities = {
  async prReviewVerify(input: VerifyFindingsInput): Promise<Finding[]> {
    return verifyFindingsImpl(input);
  },
};
