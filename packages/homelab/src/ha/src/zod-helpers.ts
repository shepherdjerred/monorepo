import { z } from "zod";

/**
 * Safely coerce a value to a string with a fallback.
 * Equivalent to z.coerce.string().catch(fallback).parse(value)
 * but avoids using Zod's .catch() method which triggers the prefer-async-await lint rule.
 */
export function safeCoerceString(value: unknown, fallback = "unknown"): string {
  const result = z.coerce.string().safeParse(value);
  return result.success ? result.data : fallback;
}

/**
 * Safely extract an error message from an unknown error value.
 * Equivalent to z.instanceof(Error).transform(e => e.message).catch(e => String(e.value)).parse(error)
 * but avoids using Zod's .catch() method which triggers the prefer-async-await lint rule.
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Safely extract an error type name from an unknown error value.
 * Equivalent to z.instanceof(Error).transform(e => e.constructor.name).catch(() => "Unknown").parse(error)
 * but avoids using Zod's .catch() method which triggers the prefer-async-await lint rule.
 */
export function safeErrorType(error: unknown): string {
  if (error instanceof Error) {
    return error.constructor.name;
  }
  return "Unknown";
}
