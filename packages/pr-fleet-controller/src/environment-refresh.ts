import { currentCommandCorrelation } from "./command-correlation.ts";
import { captureTelemetryOperation } from "./controller-telemetry.ts";
import type { FleetTelemetry } from "./ports.ts";
import type { PrIdentity, ReadinessEvidence } from "./schemas.ts";

function correlation(pr: PrIdentity) {
  return {
    ...currentCommandCorrelation(),
    prNumber: pr.number,
    headSha: pr.headSha,
  };
}

function fulfilledValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

export async function settleEvidenceParts<Checks, Reviews, Conflict>(
  checks: Promise<Checks>,
  reviews: Promise<Reviews>,
  conflict: Promise<Conflict>,
): Promise<[Checks, Reviews, Conflict]> {
  const results = await Promise.allSettled([checks, reviews, conflict]);
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === "rejected") failures.push(result.reason);
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "Multiple evidence refreshes failed");
  }
  return [
    fulfilledValue(results[0]),
    fulfilledValue(results[1]),
    fulfilledValue(results[2]),
  ];
}

export async function recordEvidenceRefresh(
  telemetry: FleetTelemetry | undefined,
  pr: PrIdentity,
  operation: () => Promise<ReadinessEvidence>,
): Promise<ReadinessEvidence> {
  let evidence: ReadinessEvidence;
  try {
    evidence = await operation();
  } catch (error) {
    captureTelemetryOperation("environment.failed", () => {
      telemetry?.record(
        "environment.failed",
        {
          operation: "refreshEvidence",
          error: error instanceof Error ? error.message : String(error),
        },
        correlation(pr),
      );
    });
    throw error;
  }
  captureTelemetryOperation("environment.result", () => {
    telemetry?.record(
      "environment.result",
      { operation: "refreshEvidence", evidence },
      correlation(pr),
    );
  });
  return evidence;
}
