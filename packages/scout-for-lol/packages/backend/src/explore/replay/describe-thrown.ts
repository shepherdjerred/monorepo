/**
 * What was actually thrown, as text.
 *
 * Its own module, with no imports, because both users must be able to reach it
 * without reaching each other. The runner loads the whole agent runtime; the
 * judge is offline by design — it reads stored bundles and calls one model —
 * and importing this from the runner quietly gave the judge a dependency on
 * Riot credentials and a Temporal namespace it never uses.
 *
 * One implementation rather than two: the second one drifted into
 * "[object Object]" and cost a sweep's error messages before anyone noticed.
 */
export function describeThrown(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause === undefined
        ? ""
        : ` (cause: ${describeThrown(error.cause)})`;
    return `${error.message}${cause}`;
  }
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error);
}
