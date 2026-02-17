/**
 * Stage enum for CI/CD environments
 */
export enum Stage {
  Prod = "prod",
  Dev = "dev",
}

/**
 * Status of a step in the CI/CD pipeline
 */
export type StepStatus = "passed" | "failed" | "skipped";

/**
 * Result of a step in the CI/CD pipeline
 */
export type StepResult = {
  status: StepStatus;
  message: string;
};

/**
 * Create a successful step result
 */
export function passedResult(message: string): StepResult {
  return { status: "passed", message };
}

/**
 * Create a failed step result
 */
export function failedResult(message: string): StepResult {
  return { status: "failed", message };
}

/**
 * Create a skipped step result
 */
export function skippedResult(message: string): StepResult {
  return { status: "skipped", message };
}
