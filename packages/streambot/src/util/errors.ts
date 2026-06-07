/** Normalize an unknown thrown value to a readable message (never throws). */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Parse JSON to `unknown` (caller must validate with Zod) — avoids `as Type` assertions. */
export function parseJson(text: string): unknown {
  return JSON.parse(text);
}
