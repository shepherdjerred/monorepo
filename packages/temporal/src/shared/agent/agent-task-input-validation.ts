import type { AgentTaskEvidenceCollectorV2 } from "./agent-task-evidence-contract.ts";
import type { z } from "zod/v4";

export function validateCollectorRelationships(
  checkIndex: number,
  collectorIndex: number,
  collector: AgentTaskEvidenceCollectorV2,
  ctx: z.RefinementCtx,
): void {
  if (
    collector.kind === "command" &&
    collector.expectation?.kind === "exit-code"
  ) {
    const acceptedExitCodes = collector.successExitCodes ?? [0];
    const unsupportedPassedExitCodes =
      collector.expectation.passedExitCodes.filter(
        (exitCode) => !acceptedExitCodes.includes(exitCode),
      );
    if (unsupportedPassedExitCodes.length > 0) {
      ctx.addIssue({
        code: "custom",
        message:
          "command expectation passedExitCodes must be included in successExitCodes",
        path: [
          "checks",
          checkIndex,
          "evidenceCollectors",
          collectorIndex,
          "expectation",
          "passedExitCodes",
        ],
      });
    }
  }
  if (
    collector.kind === "command" &&
    collector.expectation?.kind === "json" &&
    collector.output !== "json"
  ) {
    ctx.addIssue({
      code: "custom",
      message: "command JSON expectations require output=json",
      path: [
        "checks",
        checkIndex,
        "evidenceCollectors",
        collectorIndex,
        "output",
      ],
    });
  }
  if (
    collector.kind === "prometheus" &&
    collector.stepSeconds !== undefined &&
    collector.windowSeconds === undefined
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Prometheus stepSeconds requires windowSeconds",
      path: [
        "checks",
        checkIndex,
        "evidenceCollectors",
        collectorIndex,
        "stepSeconds",
      ],
    });
  }
}
