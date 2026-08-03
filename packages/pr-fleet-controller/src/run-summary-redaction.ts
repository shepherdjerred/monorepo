import { redactSecrets } from "@shepherdjerred/llm-observability";
import type { FleetSnapshot } from "./schemas.ts";

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

export function redactFleetSnapshotBodies(
  snapshot: FleetSnapshot,
  secretValues: readonly string[],
): FleetSnapshot {
  return {
    ...snapshot,
    prs: snapshot.prs.map((pr) => ({
      ...pr,
      identity: {
        ...pr.identity,
        title: redactText(pr.identity.title, secretValues),
      },
      evidence: {
        ...pr.evidence,
        buildkiteFailure:
          pr.evidence.buildkiteFailure === null
            ? null
            : {
                ...pr.evidence.buildkiteFailure,
                log: redactText(pr.evidence.buildkiteFailure.log, secretValues),
              },
        reviewFindings: pr.evidence.reviewFindings.map((finding) => ({
          ...finding,
          body: redactText(finding.body, secretValues),
        })),
      },
      escalation:
        pr.escalation === null ? null : redactText(pr.escalation, secretValues),
    })),
  };
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
