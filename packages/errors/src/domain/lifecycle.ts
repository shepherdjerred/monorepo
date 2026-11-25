import type { IssueState } from "#shared/contract.ts";

export const DEFAULT_REGRESSION_COOLDOWN_MS = 15 * 60_000;

export type OutboxAlertKind = "NEW_ISSUE" | "REGRESSION";

export type ExistingIssueLifecycleState = {
  readonly state: IssueState;
  readonly resolvedInRelease: string | null;
  readonly regressedCount: number;
  readonly lastAlertedAt: Date | null;
};

export type EvaluateIssueIngestionInput = {
  readonly existingIssue: ExistingIssueLifecycleState | null;
  readonly incomingRelease: string | null;
  readonly incomingTimestamp: Date;
  readonly alertOnNewIssue: boolean;
  readonly alertOnRegression: boolean;
  readonly cooldownMs?: number | undefined;
};

export type IssueLifecycleDecision = {
  readonly state: IssueState;
  readonly resolvedInRelease: string | null;
  readonly regressed: boolean;
  readonly regressedCount: number;
  readonly outboxKind: OutboxAlertKind | null;
  readonly lastAlertedAt: Date | null;
};

function hasCooldownElapsed(
  lastAlertedAt: Date | null,
  referenceTime: Date,
  cooldownMs: number,
): boolean {
  return (
    lastAlertedAt === null ||
    referenceTime.getTime() - lastAlertedAt.getTime() >= cooldownMs
  );
}

function buildRegressionDecision(
  existingIssue: ExistingIssueLifecycleState,
  incomingTimestamp: Date,
  alertOnRegression: boolean,
  cooldownMs: number,
): IssueLifecycleDecision {
  const shouldAlert =
    alertOnRegression &&
    hasCooldownElapsed(
      existingIssue.lastAlertedAt,
      incomingTimestamp,
      cooldownMs,
    );
  return {
    state: "OPEN",
    resolvedInRelease: null,
    regressed: true,
    regressedCount: existingIssue.regressedCount + 1,
    outboxKind: shouldAlert ? "REGRESSION" : null,
    lastAlertedAt: shouldAlert
      ? incomingTimestamp
      : existingIssue.lastAlertedAt,
  };
}

export function evaluateIssueIngestion(
  input: EvaluateIssueIngestionInput,
): IssueLifecycleDecision {
  const cooldownMs = input.cooldownMs ?? DEFAULT_REGRESSION_COOLDOWN_MS;
  const { existingIssue, incomingRelease, incomingTimestamp } = input;

  if (existingIssue === null) {
    const shouldAlert = input.alertOnNewIssue;
    return {
      state: "OPEN",
      resolvedInRelease: null,
      regressed: false,
      regressedCount: 0,
      outboxKind: shouldAlert ? "NEW_ISSUE" : null,
      lastAlertedAt: shouldAlert ? incomingTimestamp : null,
    };
  }

  switch (existingIssue.state) {
    case "OPEN": {
      return {
        state: "OPEN",
        resolvedInRelease: null,
        regressed: false,
        regressedCount: existingIssue.regressedCount,
        outboxKind: null,
        lastAlertedAt: existingIssue.lastAlertedAt,
      };
    }
    case "MUTED": {
      return {
        state: "MUTED",
        resolvedInRelease: existingIssue.resolvedInRelease,
        regressed: false,
        regressedCount: existingIssue.regressedCount,
        outboxKind: null,
        lastAlertedAt: existingIssue.lastAlertedAt,
      };
    }
    case "RESOLVED": {
      return buildRegressionDecision(
        existingIssue,
        incomingTimestamp,
        input.alertOnRegression,
        cooldownMs,
      );
    }
    case "RESOLVED_NEXT_RELEASE": {
      if (
        existingIssue.resolvedInRelease !== null &&
        incomingRelease === existingIssue.resolvedInRelease
      ) {
        return {
          state: "RESOLVED_NEXT_RELEASE",
          resolvedInRelease: existingIssue.resolvedInRelease,
          regressed: false,
          regressedCount: existingIssue.regressedCount,
          outboxKind: null,
          lastAlertedAt: existingIssue.lastAlertedAt,
        };
      }
      return buildRegressionDecision(
        existingIssue,
        incomingTimestamp,
        input.alertOnRegression,
        cooldownMs,
      );
    }
  }
}
