/**
 * A stored query the migration refuses to rewrite.
 *
 * Thrown by both the text rewriter and the independent IR translator. The
 * migration never guesses: an unconvertible row fails startup by name so a
 * human decides, rather than silently serving a report that answers a
 * different question from the one it was saved as.
 */
export class UnconvertibleQueryError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnconvertibleQueryError";
  }
}

export function unconvertible(reason: string): never {
  throw new UnconvertibleQueryError(reason);
}
