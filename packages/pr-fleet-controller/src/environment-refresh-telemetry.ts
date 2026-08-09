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
