import { requireIncludes } from "./validate-pipeline-lib.ts";

/** Validate that high-cost or optional lanes explain their contract in CI. */
export function validatePipelineClarity(
  stepBlocks: ReadonlyMap<string, string>,
): void {
  for (const [stepKey, required] of [
    [
      "trivy",
      [
        "Trivy — optional, non-blocking findings",
        "OPTIONAL SECURITY SCAN",
        "findings do not block merge",
        "scanner/runtime failures do",
        "exit_status: 7",
      ],
    ],
    [
      "semgrep",
      [
        "Semgrep — optional, non-blocking findings",
        "OPTIONAL SECURITY SCAN",
        "findings do not block merge",
        "merge-base/config/runtime failures do",
        "exit_status: 1",
      ],
    ],
  ] satisfies readonly (readonly [string, readonly string[]])[]) {
    const scanner = stepBlocks.get(stepKey);
    for (const value of required) {
      requireIncludes(
        scanner,
        value,
        `${stepKey} must make its optional/soft-fail contract explicit: ${value}`,
      );
    }
  }

  for (const [stepKey, required] of [
    [
      "playwright-e2e-pr",
      "Browser E2E scope: sjer.red, docs wiki, and Scout evals",
    ],
    [
      "playwright-e2e-main",
      "Browser E2E scope: sjer.red, docs wiki, and Scout evals",
    ],
    ["docker-e2e-pr", "llm-observability E2E — Tempo + MinIO"],
    ["docker-e2e-main", "llm-observability E2E — Tempo + MinIO"],
    ["review-gate", "Qodo review gate (required)"],
  ] satisfies readonly (readonly [string, string])[]) {
    requireIncludes(
      stepBlocks.get(stepKey),
      required,
      `${stepKey} must expose its scope in the Buildkite label/log: ${required}`,
    );
  }
}
