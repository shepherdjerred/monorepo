/**
 * Parallel execution utilities for CI/CD pipelines
 */

import type { StepResult } from "./lib-types.ts";
import { failedResult, passedResult } from "./lib-types.ts";

/**
 * Result of running multiple operations in parallel
 */
export type ParallelResults<T> = {
  /** All results (both successful and failed) */
  results: PromiseSettledResult<T>[];
  /** Successfully resolved values */
  fulfilled: T[];
  /** Rejection reasons */
  rejected: unknown[];
  /** Whether all operations succeeded */
  allSucceeded: boolean;
};

/**
 * Run multiple async operations in parallel and collect results
 *
 * Uses Promise.allSettled to ensure all operations complete even if some fail.
 *
 * @param operations - Array of promises to execute
 * @returns Collected results with success/failure categorization
 */
export async function runParallel<T>(
  operations: Promise<T>[],
): Promise<ParallelResults<T>> {
  const results = await Promise.allSettled(operations);

  const fulfilled: T[] = [];
  const rejected: unknown[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      fulfilled.push(result.value);
    } else {
      rejected.push(result.reason);
    }
  }

  return {
    results,
    fulfilled,
    rejected,
    allSucceeded: rejected.length === 0,
  };
}

/**
 * Named operation for parallel execution
 */
export type NamedOperation<T> = {
  name: string;
  operation: () => Promise<T>;
};

/**
 * Result of a named operation
 */
export type NamedResult<T> = {
  name: string;
  success: boolean;
  value?: T;
  error?: unknown;
};

/**
 * Run multiple named operations in parallel with detailed results
 *
 * @param operations - Array of named operations
 * @returns Array of named results with success/failure details
 */
export async function runNamedParallel<T>(
  operations: NamedOperation<T>[],
): Promise<NamedResult<T>[]> {
  const promises = operations.map(async (op): Promise<NamedResult<T>> => {
    try {
      const value = await op.operation();
      return { name: op.name, success: true, value };
    } catch (error) {
      return { name: op.name, success: false, error };
    }
  });

  return Promise.all(promises);
}

/**
 * Convert parallel results to StepResult array for reporting
 *
 * @param results - Named results from parallel execution
 * @returns Array of StepResults for status reporting
 */
export function collectResults<T>(results: NamedResult<T>[]): StepResult[] {
  return results.map((result) => {
    if (result.success) {
      return passedResult(`${result.name}: Success`);
    } else {
      const errorMessage =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      return failedResult(`${result.name}: ${errorMessage}`);
    }
  });
}
