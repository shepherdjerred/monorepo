import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";

/**
 * Invocation-local authority/provenance traversal allowance. Included model
 * parents count separately; JSON scalars do not. Repeated queries are charged
 * again. Current operational snapshots retain their separate scope bounds.
 * A charge may precede its query: rejected admission is not a returned-row count.
 */
export class PublicationAuthorityReadBudget {
  private remaining = 100;

  get take(): number {
    return this.remaining + 1;
  }

  /** Include the first unadmittable candidate, rather than hiding ambiguity. */
  takeWeighted(weight: number): number {
    if (!Number.isSafeInteger(weight) || weight < 1)
      throw new Error("Invalid publication authority row weight");
    return Math.floor(this.remaining / weight) + 1;
  }

  consume(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0)
      throw new Error("Invalid publication authority read count");
    this.remaining -= count;
    if (this.remaining < 0)
      throw new NativeArchiveScopeProtection(
        "Native archive authority exceeds 100 total queried records",
      );
  }
}
