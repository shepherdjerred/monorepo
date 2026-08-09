import type {
  FleetSnapshot,
  LeaseKind,
  OperatorInputRequest,
  PrState,
  WorkerResult,
} from "./schemas.ts";

const ACTIVE_STATUSES = new Set([
  "diagnosing",
  "editing",
  "verifying",
  "waiting-write-lease",
]);

export class FleetStore {
  readonly prs = new Map<number, PrState>();
  readonly activeWorkers = new Map<number, Promise<WorkerResult>>();
  readonly workerControllers = new Map<number, AbortController>();
  // Workers aborted deliberately (their PR went green, or its head advanced
  // under them) rather than by failure. Settlement must NOT pause these — a
  // green PR is done and a moved-head PR re-dispatches against the new SHA.
  readonly cancelledWorkers = new Set<number>();
  readonly workerGuidance = new Map<number, string[]>();
  // Worktree path -> the head SHA it was set up at. Setup (dependency install +
  // codegen) is only current for that head; a shared stack worktree that later
  // moves to a sibling branch, or a PR that gets a new head changing
  // deps/schemas, must re-run setup. Keying on the SHA (not just presence)
  // prevents validating against stale dependencies/generated artifacts.
  readonly setupWorktrees = new Map<string, string>();
  readonly pausedReasons = new Map<number, string>();
  readonly operatorRequests = new Map<number, OperatorInputRequest>();
  readonly inheritedCommitInspections = new Map<
    number,
    {
      remoteHeadSha: string;
      localHeadSha: string;
      complete: boolean;
    }
  >();
  readonly inheritedWipInspections = new Map<
    number,
    {
      remoteHeadSha: string;
      localHeadSha: string;
      complete: boolean;
    }
  >();
  readonly stackWriteOwners = new Map<string, number>();
  setupOwner: number | null = null;
  readonly heavyOwners = new Set<number>();
  workerLimit: number;
  stopping = false;

  constructor(workerLimit: number) {
    this.workerLimit = workerLimit;
  }

  isStopping(): boolean {
    return this.stopping;
  }

  snapshot(): FleetSnapshot {
    const prs = [...this.prs.values()]
      .filter((pr) => pr.status !== "closed")
      .sort((left, right) => left.identity.number - right.identity.number);

    return {
      open: prs.length,
      green: prs.filter((pr) => pr.classification === "green").length,
      active: prs.filter((pr) => ACTIVE_STATUSES.has(pr.status)).length,
      queued: prs.filter((pr) => pr.classification === "queued").length,
      pending: prs.filter((pr) => pr.classification === "pending").length,
      waiting: prs.filter((pr) => pr.classification === "waiting-for-answer")
        .length,
      paused: prs.filter((pr) => pr.classification === "paused").length,
      prs,
    };
  }

  requireCompleteInheritedWipInspection(pr: PrState): void {
    const context = pr.worktreeContext;
    if (context?.dirty !== true) {
      return;
    }
    const inspection = this.inheritedWipInspections.get(pr.identity.number);
    if (
      inspection === undefined ||
      !inspection.complete ||
      inspection.remoteHeadSha !== context.remoteHeadSha ||
      inspection.localHeadSha !== context.localHeadSha
    ) {
      throw new Error(
        "Inherited staged, unstaged, status, and untracked evidence must be complete for the captured heads before mutation or publication",
      );
    }
  }

  requestLease(pr: PrState, kind: LeaseKind): boolean {
    if (kind === "setup") {
      if (this.setupOwner !== null && this.setupOwner !== pr.identity.number) {
        return false;
      }
      this.setupOwner = pr.identity.number;
      return true;
    }
    if (kind === "heavy") {
      if (
        !this.heavyOwners.has(pr.identity.number) &&
        this.heavyOwners.size >= this.workerLimit
      ) {
        return false;
      }
      this.heavyOwners.add(pr.identity.number);
      return true;
    }
    const owner = this.stackWriteOwners.get(pr.stackId);
    if (owner !== undefined && owner !== pr.identity.number) {
      return false;
    }
    this.stackWriteOwners.set(pr.stackId, pr.identity.number);
    return true;
  }

  releaseLeases(prNumber: number): void {
    if (this.setupOwner === prNumber) {
      this.setupOwner = null;
    }
    this.heavyOwners.delete(prNumber);
    for (const [stackId, owner] of this.stackWriteOwners) {
      if (owner === prNumber) {
        this.stackWriteOwners.delete(stackId);
      }
    }
  }

  releaseLease(prNumber: number, kind: LeaseKind, stackId: string): void {
    if (kind === "setup" && this.setupOwner === prNumber) {
      this.setupOwner = null;
    } else if (kind === "heavy") {
      this.heavyOwners.delete(prNumber);
    } else if (
      kind === "stack-write" &&
      this.stackWriteOwners.get(stackId) === prNumber
    ) {
      this.stackWriteOwners.delete(stackId);
    }
  }

  addGuidance(prNumber: number, message: string): void {
    const existing = this.workerGuidance.get(prNumber) ?? [];
    this.workerGuidance.set(prNumber, [...existing, message]);
  }

  takeGuidance(prNumber: number): string[] {
    const guidance = this.workerGuidance.get(prNumber) ?? [];
    this.workerGuidance.delete(prNumber);
    return guidance;
  }
}
