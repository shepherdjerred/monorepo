/**
 * Expected user-facing or operational error during `brim takeover` preparation
 * or execution (unknown provider, missing session, missing terminal, etc.).
 */
export class TakeoverError extends Error {
  override name = "TakeoverError";
}
