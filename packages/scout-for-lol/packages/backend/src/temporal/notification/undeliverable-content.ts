/**
 * The message this intent would deliver cannot be produced, and no retry
 * changes that.
 *
 * Every subclass is a statement about PERSISTED evidence — a render receipt,
 * or the announcement payload carried on the intent itself. The row parses the
 * same way on every read, so a retryable failure would return the intent to
 * `ready` and let reconciliation re-drive the identical violation every sweep,
 * forever, while nobody is told. The delivery narrows on this base and parks
 * the intent as `content-unavailable` instead, which is where an operator can
 * see it.
 *
 * The distinction this draws is deliberate and narrow: it is about evidence
 * that contradicts itself or its contract, NOT about evidence that is
 * currently unreachable. An object store that timed out, a database that did
 * not answer and a Discord lookup that failed establish nothing and stay
 * retryable, because the next attempt genuinely may succeed.
 */
export abstract class UndeliverableContentError extends Error {}
