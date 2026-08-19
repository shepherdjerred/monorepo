import type {
  FleetSnapshot,
  LeaseKind,
  OperatorInputRequest,
  PrState,
  WorkerResult,
} from "./schemas.ts";

export type LeaseDecision =
  | { granted: true }
  | {
      granted: false;
      reason: "setup-held" | "heavy-capacity" | "stack-write-held";
    };

export type ControlledWorktreeHead = {
  remoteHeadSha: string;
  localHeadSha: string;
  cause: "restack" | "publication";
};

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
      fingerprint: string;
      complete: boolean;
    }
  >();
  readonly completedRestacks = new Map<
    number,
    { remoteHeadSha: string; localHeadSha: string }
  >();
  readonly activeRestacks = new Map<
    number,
    { remoteHeadSha: string; localHeadSha: string }
  >();
  // A controller-owned commit or restack legitimately moves HEAD in an
  // operator worktree. This narrow, current-remote-head fence distinguishes
  // that exact transition from an unobserved operator mutation.
  readonly controlledWorktreeHeads = new Map<number, ControlledWorktreeHead>();
  readonly stackWriteOwners = new Map<string, number>();
  readonly leaseStartedAt = new Map<string, number>();
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

  requestLease(pr: PrState, kind: LeaseKind): boolean {
    return this.requestLeaseDecision(pr, kind).granted;
  }

  requestLeaseDecision(pr: PrState, kind: LeaseKind): LeaseDecision {
    if (kind === "setup") {
      if (this.setupOwner !== null && this.setupOwner !== pr.identity.number) {
        return { granted: false, reason: "setup-held" };
      }
      this.setupOwner = pr.identity.number;
      this.#recordLeaseStart(pr.identity.number, kind);
      return { granted: true };
    }
    if (kind === "heavy") {
      if (
        !this.heavyOwners.has(pr.identity.number) &&
        this.heavyOwners.size >= this.workerLimit
      ) {
        return { granted: false, reason: "heavy-capacity" };
      }
      this.heavyOwners.add(pr.identity.number);
      this.#recordLeaseStart(pr.identity.number, kind);
      return { granted: true };
    }
    const owner = this.stackWriteOwners.get(pr.stackId);
    if (owner !== undefined && owner !== pr.identity.number) {
      return { granted: false, reason: "stack-write-held" };
    }
    this.stackWriteOwners.set(pr.stackId, pr.identity.number);
    this.#recordLeaseStart(pr.identity.number, kind);
    return { granted: true };
  }

  #recordLeaseStart(prNumber: number, kind: LeaseKind): void {
    const key = `${String(prNumber)}:${kind}`;
    if (!this.leaseStartedAt.has(key)) {
      this.leaseStartedAt.set(key, performance.now());
    }
  }

  recordControlledWorktreeHead(
    pr: PrState,
    localHeadSha: string,
    cause: ControlledWorktreeHead["cause"],
  ): void {
    this.controlledWorktreeHeads.set(pr.identity.number, {
      remoteHeadSha: pr.identity.headSha,
      localHeadSha,
      cause,
    });
  }

  expectedWorktreeHead(pr: PrState): string | undefined {
    if (pr.worktreeContext?.remoteHeadSha !== pr.identity.headSha) {
      return undefined;
    }
    const activeRestack = this.activeRestacks.get(pr.identity.number);
    if (activeRestack?.remoteHeadSha === pr.identity.headSha) {
      return activeRestack.localHeadSha;
    }
    const controlled = this.controlledWorktreeHeads.get(pr.identity.number);
    if (controlled?.remoteHeadSha === pr.identity.headSha) {
      return controlled.localHeadSha;
    }
    return pr.worktreeContext.localHeadSha;
  }

  clearControlledWorktreeHead(prNumber: number): void {
    this.controlledWorktreeHeads.delete(prNumber);
  }

  releaseLeases(prNumber: number): void {
    this.releaseLease(prNumber, "setup", "");
    this.releaseLease(prNumber, "heavy", "");
    for (const [stackId, owner] of this.stackWriteOwners) {
      if (owner === prNumber) {
        this.releaseLease(prNumber, "stack-write", stackId);
      }
    }
  }

  releaseLease(
    prNumber: number,
    kind: LeaseKind,
    stackId: string,
  ): number | null {
    let released = false;
    if (kind === "setup" && this.setupOwner === prNumber) {
      this.setupOwner = null;
      released = true;
    } else if (kind === "heavy") {
      released = this.heavyOwners.delete(prNumber);
    } else if (
      kind === "stack-write" &&
      this.stackWriteOwners.get(stackId) === prNumber
    ) {
      this.stackWriteOwners.delete(stackId);
      released = true;
    }
    if (!released) {
      return null;
    }
    const key = `${String(prNumber)}:${kind}`;
    const startedAt = this.leaseStartedAt.get(key);
    this.leaseStartedAt.delete(key);
    return startedAt === undefined
      ? null
      : Math.round(performance.now() - startedAt);
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
