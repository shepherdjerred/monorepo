import { redactSecrets } from "@shepherdjerred/llm-observability";
import { FleetSnapshotSchema, type FleetSnapshot } from "./schemas.ts";

type SummaryError = {
  message: string;
  stack?: string;
};

function redactText(value: string, secretValues: readonly string[]): string {
  const redacted = redactSecrets(value, secretValues);
  if (typeof redacted !== "string") {
    throw new TypeError("Text redaction returned a non-string value");
  }
  return redacted;
}

export function redactFleetSnapshot(
  snapshot: FleetSnapshot,
  secretValues: readonly string[],
): FleetSnapshot {
  return FleetSnapshotSchema.parse(redactSecrets(snapshot, secretValues));
}

export function redactSummaryError(
  details: SummaryError | null,
  secretValues: readonly string[],
): SummaryError | null {
  return details === null
    ? null
    : {
        message: redactText(details.message, secretValues),
        ...(details.stack === undefined
          ? {}
          : { stack: redactText(details.stack, secretValues) }),
      };
}
