/**
 * Safely extract an error message from an unknown error value.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Safely convert an unknown error value to an Error instance.
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Parse JSON and return the result as unknown, avoiding `as Type` assertions.
 * Callers should use Zod to validate the parsed value.
 */
export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/**
 * Parse JSON expecting a string array.
 * Returns the parsed array, or an empty array if parsing fails or the result is not an array.
 */
export function parseJsonStringArray(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed)
    ? parsed.filter((item) => typeof item === "string")
    : [];
}

/**
 * Parse JSON expecting a Record<string, number> (e.g., vote counts).
 */
export function parseJsonNumberRecord(text: string): Record<string, number> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "object" && parsed != null && !Array.isArray(parsed)) {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number") {
        result[key] = value;
      }
    }
    return result;
  }
  return {};
}

/**
 * Parse JSON expecting a Record<string, unknown>.
 */
export function parseJsonRecord(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed === "object" && parsed != null && !Array.isArray(parsed)) {
    // Object.entries/fromEntries rebuilds the object with the correct type
    return Object.fromEntries(Object.entries(parsed));
  }
  return {};
}
