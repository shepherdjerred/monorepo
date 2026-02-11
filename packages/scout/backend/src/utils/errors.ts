import { z } from "zod";

/**
 * Schema for validating error objects
 * Used to safely extract error messages from unknown error values
 */
export const ErrorSchema = z.object({ message: z.string() });

/**
 * Type-safe error message extraction
 *
 * @param error - Unknown error value from catch block
 * @returns Error message string, or string representation of error
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   logger.error(getErrorMessage(error));
 * }
 * ```
 */
export function getErrorMessage(error: unknown): string {
  const result = ErrorSchema.safeParse(error);
  return result.success ? result.data.message : String(error);
}
