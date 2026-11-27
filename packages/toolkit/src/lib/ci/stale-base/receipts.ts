import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { GitHubClient } from "#lib/ci/github.ts";
import type { Snapshot, Verdict } from "#lib/ci/readiness.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import {
  evaluateStaleBase,
  StaleBaseVerdictSchema,
  type StaleBaseReport,
} from "./evaluate.ts";

export type StaleBaseEvaluator = (
  headSha: string,
  baseRef: string,
  mainHeadSha: string | undefined,
  signal: AbortSignal,
) => Promise<StaleBaseReport>;

export function defaultStaleBaseEvaluator(
  github: GitHubClient,
  prNumber: number,
): StaleBaseEvaluator {
  return (headSha, baseRef, mainHeadSha, signal) =>
    evaluateStaleBase({
      github,
      prNumber,
      headSha,
      baseRef,
      mainHeadSha,
      signal,
    });
}

export const PrLandReceiptSchema = z.object({
  timestamp: z.string(),
  pr: z.number().int().positive(),
  headSha: z.string(),
  mergeBaseSha: z.string(),
  mainHeadSha: z.string(),
  behindBy: z.number().int().nonnegative(),
  verdict: StaleBaseVerdictSchema,
  bypassed: z.boolean(),
  reasons: z.array(z.string()),
});
export type PrLandReceipt = z.infer<typeof PrLandReceiptSchema>;

export function toolkitStateDirectory(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  const explicit = environment["TOOLKIT_STATE_DIR"]?.trim();
  return explicit !== undefined && explicit.length > 0
    ? explicit
    : path.join(os.homedir(), ".local", "state", "toolkit");
}

export function prLandReceiptPath(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): string {
  return path.join(toolkitStateDirectory(environment), "pr-land.ndjson");
}

export async function appendPrLandReceipt(options: {
  readonly pr: number;
  readonly report: StaleBaseReport;
  readonly bypassed: boolean;
  readonly secrets?: readonly string[] | undefined;
  readonly stateDir?: string | undefined;
  readonly environment?:
    Readonly<Record<string, string | undefined>> | undefined;
  readonly now?: (() => Date) | undefined;
}): Promise<void> {
  const secrets = options.secrets ?? [];
  const receipt: PrLandReceipt = {
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    pr: options.pr,
    headSha: sanitizeText(options.report.headSha, secrets),
    mergeBaseSha: sanitizeText(options.report.mergeBaseSha, secrets),
    mainHeadSha: sanitizeText(options.report.mainHeadSha, secrets),
    behindBy: options.report.behindBy,
    verdict: options.report.verdict,
    bypassed: options.bypassed,
    reasons: options.report.reasons.map((reason) =>
      sanitizeText(reason, secrets),
    ),
  };
  const directory =
    options.stateDir ?? toolkitStateDirectory(options.environment);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await appendFile(
      path.join(directory, "pr-land.ndjson"),
      `${JSON.stringify(receipt)}\n`,
      { mode: 0o600 },
    );
  } catch {
    // Best-effort local receipt telemetry; never fail `pr land` on a read-only fs.
  }
}

export async function recordAndGateStaleBase(options: {
  readonly pr: number;
  readonly baseRef: string;
  readonly report: StaleBaseReport;
  readonly allowStaleBase: boolean;
  readonly secrets?: readonly string[] | undefined;
  readonly stateDir?: string | undefined;
}): Promise<Verdict | null> {
  const { pr, baseRef, report, allowStaleBase } = options;
  await appendPrLandReceipt({
    pr,
    report,
    bypassed: allowStaleBase && report.stale,
    secrets: options.secrets,
    stateDir: options.stateDir,
  });
  if (allowStaleBase || !report.stale) {
    return null;
  }
  return {
    outcome: "failure",
    reasons: [
      `PR #${String(pr)} head ${report.headSha.slice(0, 12)} is behind ${baseRef} by ${String(report.behindBy)} commit(s) (${report.mergeBaseSha.slice(0, 12)}..${report.mainHeadSha.slice(0, 12)}) with overlapping changes:`,
      ...report.reasons,
    ],
    commands: [
      "toolkit git-spice repo sync --restack=aboves",
      "toolkit git-spice branch submit --update-only --no-web --no-prompt",
    ],
  };
}

export async function gateSnapshotStaleBase(options: {
  readonly pr: number;
  readonly ready: Snapshot;
  readonly evaluate: StaleBaseEvaluator;
  readonly allowStaleBase: boolean;
  readonly signal: AbortSignal;
  readonly secrets?: readonly string[] | undefined;
  readonly stateDir?: string | undefined;
}): Promise<Verdict | null> {
  const report = await options.evaluate(
    options.ready.pr.head.sha,
    options.ready.pr.base.ref,
    options.ready.main.headSha,
    options.signal,
  );
  return recordAndGateStaleBase({
    pr: options.pr,
    baseRef: options.ready.pr.base.ref,
    report,
    allowStaleBase: options.allowStaleBase,
    secrets: options.secrets,
    stateDir: options.stateDir,
  });
}
