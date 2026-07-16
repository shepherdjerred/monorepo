/**
 * Pure workflow input / signal / query types + names for `prBabysitWorkflow`.
 * Kept import-clean (no `@temporalio/workflow`) so the webhook ingress can
 * construct payloads and address signals/queries by name without pulling the
 * workflow runtime in. The workflow file binds these names with `defineSignal` /
 * `defineQuery`.
 */
import type { BabysitVerdict, PrBabysitInput } from "./types.ts";

/** State carried across `continueAsNew` to bound workflow history. */
export type BabysitResumeState = {
  iterationsTotal: number;
  costUsd: number;
  recentSignatures: string[];
  /** Original loop start (epoch ms) — survives continueAsNew for wall-clock budget. */
  startedAtEpochMs: number;
};

export type PrBabysitWorkflowInput = PrBabysitInput & {
  /** GitHub login that triggered the run (for the status comment / audit). */
  requestedBy?: string;
  /** Internal: set by continueAsNew. Never supplied by the public start path. */
  resume?: BabysitResumeState;
};

export const BABYSIT_SIGNALS = {
  /** A CI check / status completed for the PR head. */
  ciCompleted: "ciCompleted",
  /** The PR branch advanced (synchronize). */
  branchPushed: "branchPushed",
  /** New review / review-comment / issue-comment activity on the PR. */
  reviewActivity: "reviewActivity",
  /** The base branch advanced (push to main). */
  mainAdvanced: "mainAdvanced",
  /** A human guidance reply while the loop is awaiting-guidance. */
  guidance: "guidance",
  /** Stop the loop (graceful at the next await boundary). */
  stop: "stop",
} as const;

export const BABYSIT_STATUS_QUERY = "getStatus";

export type CiCompletedSignal = {
  headSha: string;
  checkName?: string;
  conclusion?: string;
};
export type BranchPushedSignal = { headSha: string };
export type ReviewActivitySignal = { kind: string; author?: string };
export type MainAdvancedSignal = { mainSha: string };
export type GuidanceSignal = {
  text: string;
  requestedBy?: string;
  commentId?: number;
};
export type StopSignal = { reason: string };

export type BabysitPhase =
  | "assessing"
  | "fixing"
  | "pushing"
  | "awaiting-ci"
  | "light-monitor"
  | "awaiting-guidance"
  | "standing-down"
  | "done";

export type BabysitStatus = {
  phase: BabysitPhase;
  iterationsTotal: number;
  costUsd: number;
  lastVerdict?: BabysitVerdict;
  awaitingGuidanceQuestion?: string;
  standDownReason?: string;
};
