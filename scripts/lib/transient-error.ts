/**
 * A failure the caller has already classified as transient — for example a
 * BuildKit/registry transport failure that `bakeFailureIsTransient` matched but
 * whose text may not match `TRANSIENT_ERROR_PATTERN` (e.g. `blob unknown`,
 * `context deadline exceeded`). `runMain` (see `./transient.ts`) maps this to
 * `EXIT_TRANSIENT` so Buildkite auto-retries the job, independent of the
 * message text.
 *
 * Kept in its own module so a script that only needs to *signal* transience
 * (e.g. `.buildkite/scripts/application-image-runtime.ts`) can import just the
 * error type without pulling in the `runMain`/pattern machinery.
 */
export class TransientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TransientError";
  }
}
